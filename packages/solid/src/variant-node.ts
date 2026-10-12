/**
 * An element's place in variant orchestration (ADR-0007, #50), shared by every Wardic surface:
 * `useWardic` (so `wardic.*` and `<Reorder.Item>`), `wardic.create(Component)` and the directives.
 *
 * Motion's rule (CONTEXT.md, **Variant child**):
 * - An element that names its own `initial` or `animate` hands its children those names. Any
 *   other passes its parent's through, unless it sets `inherit={false}`, which passes none.
 * - A **Variant child** (`variants`, no names of its own, `inherit` not `false`) inherits its
 *   ancestor's names and default transition, takes a stagger slot among the ancestor's variant
 *   children, and counts for the ancestor's `when`.
 * - An element with variants of its own (`variants`, or a name) is what its Variant children
 *   join: it owns their registry, their stagger and their `when`. Any other element passes its
 *   parent's context through, so a Variant child joins its nearest such ancestor.
 *
 * Membership is decided once, at setup, as `initial` is read. The names stay reactive.
 *
 * A server render builds the same context with the same names, once, and inert orchestration
 * (ADR-0021): stagger and `when` are timing, and never change the markup.
 */
import * as Stagger from "@wardic/core/Stagger"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { WardicTransition } from "./use-wardic.tsx"
import type { WardicChildRegistration, WardicStaggerConfig, WardicVariantContextValue } from "./variants.ts"

/** The part of an element's config its place in variant orchestration reads. */
export interface VariantConfig {
  readonly initial?: object | string | undefined
  readonly animate?: object | string | undefined
  readonly variants?: object | undefined
  readonly inherit?: boolean | undefined
  readonly transition?: WardicTransition | undefined
}

/** A variant name, or `undefined` for a values map or nothing. */
const nameOf = (entry: object | string | undefined): string | undefined =>
  Bool.match(Predicate.isString(entry), { onTrue: () => entry as string, onFalse: constUndefined })

/** Whether `config` names its own variants: its `initial` or `animate` is a name (Motion's `isControllingVariants`). */
export const namesOwnVariants = (config: VariantConfig): boolean =>
  Predicate.isString(config.initial) || Predicate.isString(config.animate)

/** Whether an element has variants of its own, so Variant children join it (Motion's `isVariantNode`). */
export const hasOwnVariants = (config: VariantConfig): boolean =>
  Predicate.isNotUndefined(config.variants) || namesOwnVariants(config)

/** Whether an element is a **Variant child** (CONTEXT.md). */
export const isVariantChild = (config: VariantConfig): boolean =>
  Predicate.isNotUndefined(config.variants) && !namesOwnVariants(config) && config.inherit !== false

/** The context an element inherits names and its default transition from: its parent's, for a Variant child. */
export const inheritedContext = (
  config: VariantConfig,
  parent: WardicVariantContextValue | undefined,
): WardicVariantContextValue | undefined => Bool.match(isVariantChild(config), { onFalse: constUndefined, onTrue: () => parent })

/**
 * The `initial` an element's Starting style resolves: its own, else the `initial` name of the context it
 * inherits from (#50). Read once, as every `initial` is.
 */
export const initialOf = (
  config: VariantConfig,
  inherited: WardicVariantContextValue | undefined,
): object | string | undefined =>
  UndefinedOr.match(config.initial, {
    onDefined: (initial) => initial,
    onUndefined: () => UndefinedOr.map(inherited, (context) => context.initial),
  })

/**
 * A name an element hands its children (Motion's `getCurrentTreeVariants`): `own` if it names its own
 * variants, else `fromParent` unless it sets `inherit={false}`.
 */
const handedDown = (config: VariantConfig, own: () => string | undefined, fromParent: () => string | undefined): string | undefined =>
  Bool.match(namesOwnVariants(config), {
    onTrue: own,
    onFalse: () => Bool.match(config.inherit === false, { onTrue: constUndefined, onFalse: fromParent }),
  })

/** The stagger config an element's `transition` gives its Variant children. */
const staggerOf = (transition: WardicTransition | undefined): WardicStaggerConfig => ({
  amount: transition?.staggerChildren ?? 0,
  delayChildren: transition?.delayChildren ?? 0,
  from: transition?.from ?? "first",
  direction: transition?.staggerDirection ?? 1,
})

/** What an element provides when it has no variants of its own: its parent's context, unless `inherit={false}`. */
const passedThrough = (
  config: VariantConfig,
  parent: WardicVariantContextValue | undefined,
): WardicVariantContextValue | undefined => Bool.match(config.inherit === false, { onTrue: constUndefined, onFalse: () => parent })

/** An element's place in variant orchestration, on the client. */
export interface VariantNode {
  /** What its children read: its own context, its parent's passed through, or none. */
  readonly provided: WardicVariantContextValue | undefined
  /** The context its spine inherits names and its default transition from: its parent's, for a Variant child. */
  readonly inherited: WardicVariantContextValue | undefined
  /** Its stagger delay in seconds, as a Variant child; `undefined` for any other element. */
  readonly extraDelay: (() => number) | undefined
  /** Whether its spine may start a Retarget: its ancestor's `beforeChildren` and its own `afterChildren` allow it. */
  readonly canStart: () => boolean
  /** Its spine's settle report on each frame: to its ancestor's registry, and to its own `beforeChildren`. */
  readonly onFrame: (done: boolean) => void
}

/** The orchestration an element with variants of its own runs for its Variant children. */
interface OwnOrchestration {
  readonly context: WardicVariantContextValue
  readonly canStart: () => boolean
  readonly settled: (done: boolean) => void
}

/** A registered Variant child, as its ancestor's registry holds it. */
interface ChildRecord {
  readonly setIndex: (i: number) => void
  readonly setTotal: (n: number) => void
}

/**
 * The registry, stagger and `when` an element with variants of its own runs for its Variant
 * children (ADR-0007), and the names it hands them. Call within a Solid owner.
 */
const ownOrchestration = (
  cfg: Accessor<VariantConfig>,
  parent: WardicVariantContextValue | undefined,
  inherited: WardicVariantContextValue | undefined,
): OwnOrchestration => {
  const config = untrack(cfg)
  // Children in mount order (a Set keeps insertion order); the effect below snapshots that
  // order at each trigger. Kept with a count of the unsettled ones rather than a signal of the
  // records, so a child's mount, unmount or settle costs the same at 1,000 children as at 1.
  const records = new Set<ChildRecord>()
  const [unsettled, setUnsettled] = createSignal(0)
  // True once this element's own animation settles; false again at each variant change.
  // Drives `beforeChildren`.
  const [ownSettled, setOwnSettled] = createSignal(false)

  const register = (): WardicChildRegistration => {
    const [index, setIndex] = createSignal(0)
    const [total, setTotal] = createSignal(1)
    const record: ChildRecord = { setIndex, setTotal }
    // A child starts unsettled; its spine reports each frame, so only a change counts.
    let settled = false
    records.add(record)
    setUnsettled((k) => k + 1)
    const setSettled = (done: boolean): void => {
      if (done === settled) return
      settled = done
      setUnsettled((k) => k + (done ? -1 : 1))
    }
    const dispose = (): void => {
      if (!records.delete(record)) return
      if (!settled) setUnsettled((k) => k - 1)
    }
    return { index, total, setSettled, dispose }
  }

  const stagger: Accessor<WardicStaggerConfig> = createMemo(() => staggerOf(cfg().transition))
  const when: Accessor<"beforeChildren" | "afterChildren" | undefined> = () => cfg().transition?.when

  // The names handed down. `animate`'s is reactive; `initial`'s is read once.
  const variant: Accessor<string | undefined> = createMemo(() => {
    const c = cfg()
    return handedDown(c, () => nameOf(c.animate), () => parent?.variant())
  })
  const initial = handedDown(config, () => nameOf(config.initial), () => parent?.initial)

  // Snapshot-at-trigger (ADR-0007): each child's index and total are recomputed only when this
  // element's variant changes, so a mount, unmount or reorder mid-transition doesn't reshuffle
  // in-flight delays. `staggerDirection: -1` reverses the index.
  createEffect(
    on(variant, () => {
      const n = records.size
      const direction = untrack(stagger).direction
      Array.from(records).forEach((record, i) => {
        record.setTotal(n)
        record.setIndex(direction === -1 ? n - 1 - i : i)
      })
      setOwnSettled(false)
    }),
  )

  const childrenMayStart: Accessor<boolean> = () => when() !== "beforeChildren" || ownSettled()
  const allChildrenSettled: Accessor<boolean> = () => unsettled() === 0
  // The transition its children default to: its own, else the one it inherits.
  const transition: Accessor<WardicTransition | undefined> = createMemo(() => cfg().transition ?? inherited?.transition())

  return {
    context: { variant, initial, transition, register, stagger, when, childrenMayStart, allChildrenSettled },
    // It holds its own start for `afterChildren` (it owns the registry, so it reads it directly).
    canStart: () => when() !== "afterChildren" || allChildrenSettled(),
    settled: (done) => setOwnSettled(done),
  }
}

/**
 * An element's place in variant orchestration on the client, from its config and the nearest
 * context (`useVariantContext()`). Call within a Solid owner.
 */
export const createVariantNode = (cfg: Accessor<VariantConfig>, parent: WardicVariantContextValue | undefined): VariantNode => {
  const config = untrack(cfg)
  const inherited = inheritedContext(config, parent)
  // A Variant child registers with the ancestor it joins, for its stagger slot and its `when`.
  const joined = UndefinedOr.map(inherited, (context) => ({ context, registration: context.register() }))
  if (Predicate.isNotUndefined(joined)) onCleanup(joined.registration.dispose)
  const own = Bool.match(hasOwnVariants(config), {
    onFalse: constUndefined,
    onTrue: () => ownOrchestration(cfg, parent, inherited),
  })
  return {
    provided: UndefinedOr.match(own, { onDefined: (o) => o.context, onUndefined: () => passedThrough(config, parent) }),
    inherited,
    extraDelay: UndefinedOr.map(joined, ({ context, registration }) => () => {
      const s = context.stagger()
      return s.delayChildren + Stagger.make(s.amount, { from: s.from })(registration.index(), registration.total())
    }),
    canStart: () =>
      UndefinedOr.match(inherited, { onUndefined: constTrue, onDefined: (context) => context.childrenMayStart() }) &&
      UndefinedOr.match(own, { onUndefined: constTrue, onDefined: (o) => o.canStart() }),
    onFrame: (done) => {
      UndefinedOr.match(joined, { onUndefined: constVoid, onDefined: ({ registration }) => registration.setSettled(done) })
      UndefinedOr.match(own, { onUndefined: constVoid, onDefined: (o) => o.settled(done) })
    },
  }
}

/** A registration that does nothing: a server render has no orchestration to join. */
export const INERT_REGISTRATION: WardicChildRegistration = Object.freeze({
  index: () => 0,
  total: () => 1,
  setSettled: () => {},
  dispose: () => {},
})

/** An element's place in variant orchestration during a server render (ADR-0021). */
export interface ServerVariantNode {
  /** What its children read: the same context the client builds, with inert orchestration. */
  readonly provided: WardicVariantContextValue | undefined
  /** The context it inherits from: its parent's, for a Variant child. */
  readonly inherited: WardicVariantContextValue | undefined
}

/**
 * {@link createVariantNode} during a server render: the same names, read once, and orchestration
 * that does nothing. No runtime, no signals.
 */
export const serverVariantNode = (config: VariantConfig, parent: WardicVariantContextValue | undefined): ServerVariantNode => {
  const inherited = inheritedContext(config, parent)
  const own = (): WardicVariantContextValue => {
    const variant = handedDown(config, () => nameOf(config.animate), () => parent?.variant())
    const transition = config.transition ?? inherited?.transition()
    const stagger = staggerOf(config.transition)
    return {
      variant: () => variant,
      initial: handedDown(config, () => nameOf(config.initial), () => parent?.initial),
      transition: () => transition,
      register: () => INERT_REGISTRATION,
      stagger: () => stagger,
      when: () => config.transition?.when,
      childrenMayStart: constTrue,
      allChildrenSettled: constTrue,
    }
  }
  return {
    provided: Bool.match(hasOwnVariants(config), { onTrue: own, onFalse: () => passedThrough(config, parent) }),
    inherited,
  }
}
