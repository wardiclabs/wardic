/**
 * An element's place in variant orchestration on the Solid 1 binding (ADR-0007, #50), shared by
 * every Wardic surface: `createWard` (so `wardic.*` and `<Reorder.Item>`), `wardic.create(Component)`
 * and the directives. The rules it runs are Solid-free, in `variant-tree.ts` (#209).
 *
 * Membership is decided once, at setup, as `initial` is read. The names stay reactive.
 */
import * as Stagger from "@wardic/core/Stagger"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { WardicTransition, WardicVariantLabels } from "./config.ts"
import {
  activeNamesOf,
  type GestureHandDown,
  handDownFrom,
  handDownOf,
  type GestureStates,
  NO_GESTURE_STATES,
  NO_HAND_DOWN,
  sameHandDown,
  topGestureName,
  triggerKeyOf,
  handedDown,
  hasOwnVariants,
  inheritedContext,
  initialNameOf,
  nameOf,
  ownOrInherited,
  directed,
  mayStartOf,
  type NameConfig,
  nameConfigOf,
  type NameOrchestration,
  passedThrough,
  staggerOf,
  staggerOfName,
  type VariantConfig,
  type WardicChildRegistration,
  type WardicStaggerConfig,
  type WardicVariantContextValue,
} from "./variant-tree.ts"
import { ownTransitionOf, sameLabels, transitionOfTarget } from "./variant-target.ts"

/** An element's place in variant orchestration, on the client. */
export interface VariantNode {
  /** What its children read: its own context, its parent's passed through, or none. */
  readonly provided: WardicVariantContextValue | undefined
  /** The context its spine inherits names and its default transition from: its parent's, for a Variant child. */
  readonly inherited: WardicVariantContextValue | undefined
  /** Its stagger delay in seconds, as a Variant child; `undefined` for any other element. */
  readonly extraDelay: ((name: string | undefined) => number) | undefined
  /** Whether its spine may start a Retarget: its ancestor's `beforeChildren` and its own `afterChildren` allow it. */
  readonly canStart: () => boolean
  /** Its spine's settle report on each frame: to its ancestor's registry, and to its own `beforeChildren`. */
  readonly onFrame: (done: boolean) => void
  /**
   * Bind its spine's gesture states (#291), once it mounts: the names it hands its Variant children
   * follow them. Only an element whose Variant children join it has one.
   */
  readonly bindGestures: ((states: Accessor<GestureStates>) => void) | undefined
  /**
   * A list's names orchestrated each on their own (#297's PR 2): its spine's gates and per-name
   * settles. Only an element that joins a provider or provides has one.
   */
  readonly names: NameOrchestration | undefined
}

/** The orchestration an element with variants of its own runs for its Variant children. */
interface OwnOrchestration {
  readonly context: WardicVariantContextValue
  readonly canStart: () => boolean
  readonly settled: (done: boolean) => void
  readonly bindGestures: (states: Accessor<GestureStates>) => void
  /** A list's name's own `afterChildren` (#297's PR 2): its keys wait for its children's of that name. */
  readonly canStartFor: (name: string) => boolean
  /** Its keys of a list's names settled, or moving again (#297's PR 2). */
  readonly settledFor: (names: ReadonlyArray<string>, done: boolean) => void
}

/** A registered Variant child, as its ancestor's registry holds it. */
/** A registered Variant child's stagger slot, as its ancestor's registry holds it: set at each trigger. */
interface ChildRecord {
  index: number
  total: number
  /** The names of a list whose keys it has settled since the list last changed (#297's PR 2). */
  readonly names: Set<string>
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
  // The names of a list whose own keys have settled since the list last changed (#297's PR 2).
  const ownNames = new Set<string>()
  // True once this element's own animation settles; false again at each variant change.
  // Drives `beforeChildren`.
  const [ownSettled, setOwnSettled] = createSignal(false)

  const register = (): WardicChildRegistration => {
    const record: ChildRecord = { index: 0, total: 1, names: new Set() }
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
    return {
      index: () => {
        fresh()
        return record.index
      },
      total: () => {
        fresh()
        return record.total
      },
      setSettled,
      setSettledFor: (name, done) => {
        Bool.match(done, { onTrue: () => record.names.add(name), onFalse: () => record.names.delete(name) })
      },
      dispose,
    }
  }

  // Snapshot-at-trigger (ADR-0007): each child's index and total are recomputed only when a trigger
  // (this element's variant, or its gestures' names, #291) changes, so a mount, unmount or reorder
  // mid-transition doesn't reshuffle in-flight delays. `staggerDirection: -1` reverses the index.
  // Taken at the first slot read after the change (as the Solid 2 binding's, #209 PR 4a): a child
  // the same change Retargets reads its slot before an effect of this element's could run.
  let stale = true
  const fresh = (): void => {
    if (!stale) return
    stale = false
    // Each in order: a name's `staggerDirection` turns it at its delay (#297), a list's names each theirs.
    const n = records.size
    let i = 0
    records.forEach((record) => {
      record.total = n
      record.index = i
      i++
    })
  }

  // The names handed down. `animate`'s is reactive; `initial`'s is read once.
  // A list the same name by name is no change (#297).
  const variant: Accessor<WardicVariantLabels | undefined> = createMemo(
    () => {
      const c = cfg()
      return handedDown(c, () => nameOf(c.animate), () => UndefinedOr.map(parent, (p) => p.variant()))
    },
    undefined,
    { equals: sameLabels },
  )

  // What it hands down for its gestures (#291), whether each is on and its label: its spine's states, bound once it mounts.
  // Changed only when a name does, so its children re-resolve only then.
  const [states, setStates] = createSignal<Accessor<GestureStates> | undefined>(undefined)
  const gestures: Accessor<GestureHandDown> = createMemo(
    () => handDownOf(cfg(), UndefinedOr.match(states(), { onUndefined: () => NO_GESTURE_STATES, onDefined: (on) => on() }), handDownFrom(inherited)),
    NO_HAND_DOWN,
    { equals: sameHandDown },
  )

  // Its orchestration (#277, #291, Motion's): the own transition of its highest active gesture's name,
  // else of its target (the variant it names), else its `transition`.
  const orchestration: Accessor<WardicTransition | undefined> = createMemo(() => {
    const c = cfg()
    const own = UndefinedOr.match(topGestureName(activeNamesOf(gestures())), {
      onDefined: (name) => ownTransitionOf(undefined, name, c.variants, c.custom),
      onUndefined: () => ownTransitionOf(c.animate, variant(), c.variants, c.custom),
    })
    return transitionOfTarget(own, c.transition)
  })
  // What its children's stagger and `when` snapshot at: its variant, and its gestures' names (#291).
  const trigger: Accessor<string> = createMemo((previous: string | undefined) => {
    const next = triggerKeyOf(variant(), gestures())
    if (next !== previous) {
      stale = true
      // Each name waits again (#297's PR 2): its keys, and its children's, settle anew.
      ownNames.clear()
      records.forEach((record) => record.names.clear())
    }
    return next
  })
  const stagger: Accessor<WardicStaggerConfig> = createMemo(() => staggerOf(orchestration()))
  // A list's names have each their own (#297's PR 2): none for the list as a whole.
  const when: Accessor<"beforeChildren" | "afterChildren" | undefined> = () => {
    if (Array.isArray(variant())) return undefined
    return UndefinedOr.map(orchestration(), (t) => t.when)
  }
  const initial = handedDown<WardicVariantLabels | false>(config, () => initialNameOf(config.initial), () => UndefinedOr.map(parent, (p) => p.initial))

  // Each name's orchestration for the Variant children's keys of that name (#297, Motion's
  // `animateVariant` a name): its own transition's, else the element's. Kept per name until the
  // config changes; a key from no name takes the element's whole orchestration.
  const byName: Accessor<Map<string, NameConfig>> = createMemo(() => {
    cfg()
    return new Map()
  })
  const configOf = (name: string): NameConfig => {
    const known = byName()
    const kept = known.get(name)
    if (Predicate.isNotUndefined(kept)) return kept
    const c = untrack(cfg)
    const made = nameConfigOf(transitionOfTarget(ownTransitionOf(undefined, name, c.variants, c.custom), c.transition))
    known.set(name, made)
    return made
  }
  const staggerFor = (name: string | undefined): WardicStaggerConfig => {
    if (Predicate.isUndefined(name)) return stagger()
    return configOf(name).stagger
  }
  // Each of a list's names' own `when` (#297's PR 2), read by polling: which of its names' keys have
  // settled since the list last changed (`ownNames`, above), and (in each record) its children's.
  const mayStartFor = (name: string): boolean => Bool.or(untrack(() => configOf(name)).when !== "beforeChildren", ownNames.has(name))
  const canStartFor = (name: string): boolean => {
    if (untrack(() => configOf(name)).when !== "afterChildren") return true
    let all = true
    records.forEach((record) => {
      if (Bool.not(record.names.has(name))) all = false
    })
    return all
  }
  const settledFor = (names: ReadonlyArray<string>, done: boolean): void =>
    Arr.forEach(names, (name) => {
      Bool.match(done, { onTrue: () => ownNames.add(name), onFalse: () => ownNames.delete(name) })
    })

  // `beforeChildren` waits again at each trigger, until this element's own animation settles.
  createEffect(
    on(trigger, () => {
      setOwnSettled(false)
    }),
  )

  const childrenMayStart: Accessor<boolean> = () => when() !== "beforeChildren" || ownSettled()
  const allChildrenSettled: Accessor<boolean> = () => unsettled() === 0
  // The transition its children default to: its own, else the one it inherits.
  const transition: Accessor<WardicTransition | undefined> = createMemo(() => ownOrInherited(cfg().transition, inherited))

  return {
    context: { variant, initial, transition, gestures, register, stagger, staggerFor, mayStartFor, when, childrenMayStart, allChildrenSettled },
    // It holds its own start for `afterChildren` (it owns the registry, so it reads it directly).
    canStart: () => when() !== "afterChildren" || allChildrenSettled(),
    settled: (done) => setOwnSettled(done),
    bindGestures: (on) => {
      setStates(() => on)
    },
    canStartFor,
    settledFor,
  }
}

/** A node's gesture binding: its own orchestration's, none without one. A guard: it's made per element. */
const bindOf = (own: OwnOrchestration | undefined): ((states: Accessor<GestureStates>) => void) | undefined => {
  if (Predicate.isUndefined(own)) return undefined
  return own.bindGestures
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
    extraDelay: UndefinedOr.map(joined, ({ context, registration }) => (name: string | undefined) => {
      const s = staggerOfName(context, name)
      const n = registration.total()
      return s.delayChildren + Stagger.make(s.amount, { from: s.from })(directed(registration.index(), n, s.direction), n)
    }),
    canStart: () =>
      UndefinedOr.match(inherited, { onUndefined: constTrue, onDefined: (context) => context.childrenMayStart() }) &&
      UndefinedOr.match(own, { onUndefined: constTrue, onDefined: (o) => o.canStart() }),
    onFrame: (done) => {
      reportJoined(done)
      reportOwn(done)
    },
    bindGestures: bindOf(own),
    names: namesOf(joined, own),
  }
}

/**
 * Its spine's per-name orchestration (#297's PR 2): a name's keys start once its provider's
 * `beforeChildren` and its own `afterChildren` for that name allow; their starts and settles are told
 * to both. None for an element that joins nothing and provides nothing: made per element, a guard.
 */
const namesOf = (
  joined: { readonly context: WardicVariantContextValue; readonly registration: WardicChildRegistration } | undefined,
  own: OwnOrchestration | undefined,
): NameOrchestration | undefined => {
  if (Bool.and(Predicate.isUndefined(joined), Predicate.isUndefined(own))) return undefined
  const tell = (names: ReadonlyArray<string>, done: boolean): void => {
    UndefinedOr.map(joined, ({ registration }) => UndefinedOr.map(registration.setSettledFor, (set) => Arr.forEach(names, (name) => set(name, done))))
    UndefinedOr.map(own, (o) => o.settledFor(names, done))
  }
  return {
    mayStart: (name) =>
      Bool.and(
        UndefinedOr.match(joined, { onUndefined: constTrue, onDefined: ({ context }) => mayStartOf(context, name) }),
        UndefinedOr.match(own, { onUndefined: constTrue, onDefined: (o) => o.canStartFor(name) }),
      ),
    moving: (names) => tell(names, false),
    settled: (names) => tell(names, true),
  }
}
