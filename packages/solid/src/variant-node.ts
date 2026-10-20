/**
 * An element's place in variant orchestration on the Solid 1 binding (ADR-0007, #50), shared by
 * every Wardic surface: `createWard` (so `wardic.*` and `<Reorder.Item>`), `wardic.create(Component)`
 * and the directives. The rules it runs are Solid-free, in `variant-tree.ts` (#209).
 *
 * Membership is decided once, at setup, as `initial` is read. The names stay reactive.
 */
import * as Stagger from "@wardic/core/Stagger"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { WardicTransition } from "./config.ts"
import {
  handedDown,
  hasOwnVariants,
  inheritedContext,
  initialNameOf,
  nameOf,
  ownOrInherited,
  passedThrough,
  staggerOf,
  type VariantConfig,
  type WardicChildRegistration,
  type WardicStaggerConfig,
  type WardicVariantContextValue,
} from "./variant-tree.ts"

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
      setUnsettled((k) => k + Bool.match(done, { onTrue: () => -1, onFalse: () => 1 }))
    }
    const dispose = (): void => {
      if (!records.delete(record)) return
      if (!settled) setUnsettled((k) => k - 1)
    }
    return { index, total, setSettled, dispose }
  }

  const stagger: Accessor<WardicStaggerConfig> = createMemo(() => staggerOf(cfg().transition))
  const when: Accessor<"beforeChildren" | "afterChildren" | undefined> = () => UndefinedOr.map(cfg().transition, (t) => t.when)

  // The names handed down. `animate`'s is reactive; `initial`'s is read once.
  const variant: Accessor<string | undefined> = createMemo(() => {
    const c = cfg()
    return handedDown(c, () => nameOf(c.animate), () => UndefinedOr.map(parent, (p) => p.variant()))
  })
  const initial = handedDown<string | false>(config, () => initialNameOf(config.initial), () => UndefinedOr.map(parent, (p) => p.initial))

  // Snapshot-at-trigger (ADR-0007): each child's index and total are recomputed only when this
  // element's variant changes, so a mount, unmount or reorder mid-transition doesn't reshuffle
  // in-flight delays. `staggerDirection: -1` reverses the index.
  createEffect(
    on(variant, () => {
      const n = records.size
      const direction = untrack(stagger).direction
      Array.from(records).forEach((record, i) => {
        record.setTotal(n)
        record.setIndex(Bool.match(direction === -1, { onTrue: () => n - 1 - i, onFalse: () => i }))
      })
      setOwnSettled(false)
    }),
  )

  const childrenMayStart: Accessor<boolean> = () => when() !== "beforeChildren" || ownSettled()
  const allChildrenSettled: Accessor<boolean> = () => unsettled() === 0
  // The transition its children default to: its own, else the one it inherits.
  const transition: Accessor<WardicTransition | undefined> = createMemo(() => ownOrInherited(cfg().transition, inherited))

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
  // The spine reports on every frame (the per-frame path, docs/agents/effect-first.md): both
  // reports are resolved here, once, so a frame makes two plain calls and allocates nothing.
  const reportJoined: (done: boolean) => void = UndefinedOr.match(joined, {
    onUndefined: () => constVoid,
    onDefined: ({ registration }) => registration.setSettled,
  })
  const reportOwn: (done: boolean) => void = UndefinedOr.match(own, { onUndefined: () => constVoid, onDefined: (o) => o.settled })
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
      reportJoined(done)
      reportOwn(done)
    },
  }
}
