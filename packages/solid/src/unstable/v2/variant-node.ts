/**
 * An element's place in variant orchestration on Solid 2 (ADR-0007, #50, #209): the variant context
 * a ward's `.Provider` and every `wardic.*` element provide, and the registry, stagger and `when` an
 * element with variants of its own runs for its Variant children. The rules are the Solid 1
 * binding's, Solid-free in `variant-tree.ts`; what Solid 2 changes is when a write is seen.
 *
 * A Solid 2 signal's read lags its write until the flush, and an effect's apply runs in an order
 * the binding doesn't choose. So nothing a child reads at its Retarget is written by an effect at
 * the trigger:
 *
 * - **Stagger slots** are plain fields, snapshotted as the handed-down name changes, in the memo
 *   that computes it. Every Variant child reads that memo for its target, so the snapshot is taken
 *   before any child's Retarget in that flush, and read there through its `extraDelay`.
 * - **`beforeChildren`** compares two values its children read in the same flush: the name handed
 *   down now, and the one the element last settled at (written by its spine's frames, outside any
 *   flush). A new name holds them until the element settles at it.
 *
 * @module
 */
import * as Stagger from "@wardic/core/Stagger"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createContext, createMemo, createSignal, onCleanup, untrack, useContext } from "solid-js"
import type { WardicTransition, WardicVariantLabels } from "../../config.ts"
import {
  activeNamesOf,
  type GestureHandDown,
  handDownFrom,
  handDownOf,
  type GestureStates,
  NO_GESTURE_STATES,
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
  passedThrough,
  staggerOf,
  staggerOfName,
  type VariantConfig,
  type WardicChildRegistration,
  type WardicStaggerConfig,
  type WardicVariantContextValue,
} from "../../variant-tree.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import { ownTransitionOf, sameLabels, transitionOfTarget } from "../../variant-target.ts"

/**
 * The variant context: the nearest element's names, transition and orchestration, `null` outside
 * one. Solid 2 takes an `undefined` default for none and then throws in `useContext`.
 */
export const WardicVariantContext = createContext<WardicVariantContextValue | null>(null)

/** The nearest variant context, `undefined` outside one. */
export const useVariantContext = (): WardicVariantContextValue | undefined =>
  Option.getOrUndefined(Option.fromNullishOr(useContext(WardicVariantContext)))

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
   * Bind its spine's gesture states (#291), at its ward's setup: the names it hands its Variant
   * children follow them. Only an element whose Variant children join it has one.
   */
  readonly bindGestures: ((states: Accessor<GestureStates>) => void) | undefined
}

/** The orchestration an element with variants of its own runs for its Variant children. */
interface OwnOrchestration {
  readonly context: WardicVariantContextValue
  readonly canStart: () => boolean
  readonly settled: (done: boolean) => void
  readonly bindGestures: (states: Accessor<GestureStates>) => void
}

/** A registered Variant child's stagger slot, as its ancestor's registry holds it: set at each trigger. */
interface ChildRecord {
  index: number
  total: number
}

/** What an element has settled at while it moves: no name. */
const MOVING: unique symbol = Symbol("wardic.moving")

/**
 * The registry, stagger and `when` an element with variants of its own runs for its Variant
 * children (ADR-0007), and the names it hands them. Call within a Solid owner.
 */
const ownOrchestration = (
  cfg: Accessor<VariantConfig>,
  config: VariantConfig,
  parent: WardicVariantContextValue | undefined,
  inherited: WardicVariantContextValue | undefined,
): OwnOrchestration => {
  // Children in mount order (a Set keeps insertion order), snapshotted at each trigger. Kept with a
  // count of the unsettled ones rather than a signal of the records, so a child's mount, unmount or
  // settle costs the same at 1,000 children as at 1. The count is plain, and the signal its copy:
  // two writes in one flush each see the other's. A Variant child registers in its own body, an owned
  // scope, as it renders: so this signal is written there (`ownedWrite`, #257's audit).
  const records = new Set<ChildRecord>()
  let unsettledCount = 0
  const [unsettled, setUnsettled] = createSignal(0, { ownedWrite: true })
  const countUnsettled = (change: number): void => {
    unsettledCount += change
    setUnsettled(unsettledCount)
  }

  const register = (): WardicChildRegistration => {
    const record: ChildRecord = { index: 0, total: 1 }
    // A child starts unsettled; its spine reports each frame, so only a change counts.
    let settled = false
    records.add(record)
    countUnsettled(1)
    const setSettled = (done: boolean): void => {
      if (done === settled) return
      settled = done
      countUnsettled(Bool.match(done, { onTrue: () => -1, onFalse: () => 1 }))
    }
    const dispose = (): void => {
      if (!records.delete(record)) return
      if (!settled) countUnsettled(-1)
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
      dispose,
    }
  }


  // Snapshot-at-trigger (ADR-0007): each child's index and total are recomputed only when this
  // element's variant changes, so a mount, unmount or reorder mid-transition doesn't reshuffle
  // in-flight delays. `staggerDirection: -1` reverses the index. Taken at the first slot read after
  // the change (#209 PR 4a): at mount this element's name is first computed in its setup, before
  // its children register, and they read their slots at their first Retarget, once all have.
  let stale = true
  const fresh = (): void => {
    if (!stale) return
    stale = false
    snapshotSlots()
  }
  // Each in order: a name's `staggerDirection` turns it at its delay (#297), a list's names each theirs.
  const snapshotSlots = (): void => {
    const n = records.size
    let i = 0
    records.forEach((record) => {
      record.total = n
      record.index = i
      i++
    })
  }

  // The names handed down. `animate`'s is reactive, its change the trigger; `initial`'s is read once.
  // A list the same name by name is no change (#297): the one before is kept.
  const variant: Accessor<WardicVariantLabels | undefined> = createMemo(
    (previous: WardicVariantLabels | undefined) => {
      const c = cfg()
      const next = handedDown(c, () => nameOf(c.animate), () => UndefinedOr.map(parent, (p) => p.variant()))
      if (sameLabels(next, previous)) return previous
      stale = true
      return next
    },
    { ...CLIENT_ONLY, equals: (a: WardicVariantLabels | undefined, b: WardicVariantLabels | undefined) => sameLabels(a, b) },
  )

  // What it hands down for its gestures (#291), whether each is on and its label: its spine's states, bound at its ward's
  // setup. Changed only when a name does, so its children re-resolve only then; a change is a trigger.
  const [states, setStates] = createSignal<Accessor<GestureStates> | undefined>(undefined, { ownedWrite: true })
  const gestures: Accessor<GestureHandDown> = createMemo(
    (previous: GestureHandDown | undefined) => {
      const next = handDownOf(cfg(), UndefinedOr.match(states(), { onUndefined: () => NO_GESTURE_STATES, onDefined: (on) => on() }), handDownFrom(inherited))
      if (Predicate.isNotUndefined(previous) && sameHandDown(previous, next)) return previous
      stale = true
      return next
    },
    { ...CLIENT_ONLY, equals: (a: GestureHandDown, b: GestureHandDown) => sameHandDown(a, b) },
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
  }, CLIENT_ONLY)
  // What its `beforeChildren` settles at: its variant, and its gestures' names (#291).
  const trigger: Accessor<string> = createMemo(() => triggerKeyOf(variant(), gestures()), CLIENT_ONLY)
  const stagger: Accessor<WardicStaggerConfig> = createMemo(() => staggerOf(orchestration()), CLIENT_ONLY)
  const when: Accessor<"beforeChildren" | "afterChildren" | undefined> = () => UndefinedOr.map(orchestration(), (t) => t.when)
  const initial = handedDown<WardicVariantLabels | false>(config, () => initialNameOf(config.initial), () => UndefinedOr.map(parent, (p) => p.initial))

  // Each name's orchestration for the Variant children's keys of that name (#297, Motion's
  // `animateVariant` a name): its own transition's, else the element's. Kept per name until what it's
  // resolved from changes; a key from no name takes the element's whole orchestration.
  const byName: Accessor<Map<string, WardicStaggerConfig>> = createMemo(() => {
    const c = cfg()
    void c.variants
    void c.custom
    void c.transition
    return new Map<string, WardicStaggerConfig>()
  }, CLIENT_ONLY)
  const staggerFor = (name: string | undefined): WardicStaggerConfig => {
    if (Predicate.isUndefined(name)) return untrack(stagger)
    const known = untrack(byName)
    const kept = known.get(name)
    if (Predicate.isNotUndefined(kept)) return kept
    const c = untrack(cfg)
    const made = untrack(() => staggerOf(transitionOfTarget(ownTransitionOf(undefined, name, c.variants, c.custom), c.transition)))
    known.set(name, made)
    return made
  }

  // The name this element last settled at: `MOVING` while its own animation runs.
  const [settledAt, setSettledAt] = createSignal<string | undefined | typeof MOVING>(MOVING)

  const childrenMayStart: Accessor<boolean> = () => when() !== "beforeChildren" || settledAt() === trigger()
  const allChildrenSettled: Accessor<boolean> = () => unsettled() === 0
  // The transition its children default to: its own, else the one it inherits.
  const transition: Accessor<WardicTransition | undefined> = createMemo(() => ownOrInherited(cfg().transition, inherited), CLIENT_ONLY)

  return {
    context: { variant, initial, transition, gestures, register, stagger, staggerFor, when, childrenMayStart, allChildrenSettled },
    // It holds its own start for `afterChildren` (it owns the registry, so it reads it directly).
    canStart: () => when() !== "afterChildren" || allChildrenSettled(),
    settled: (done) => {
      setSettledAt(Bool.match(done, { onTrue: () => untrack(trigger), onFalse: (): typeof MOVING => MOVING }))
    },
    bindGestures: (on) => {
      setStates(() => on)
    },
  }
}

/** A node's gesture binding: its own orchestration's, none without one. A guard: it's made per element. */
const bindOf = (own: OwnOrchestration | undefined): ((states: Accessor<GestureStates>) => void) | undefined => {
  if (Predicate.isUndefined(own)) return undefined
  return own.bindGestures
}

/**
 * An element's place in variant orchestration on the client, from its config (`cfg`, read where it
 * tracks; `config`, the ward's plain copy at setup, #259) and the nearest context
 * (`useVariantContext()`). Call within a Solid owner.
 */
export const createVariantNode = (cfg: Accessor<VariantConfig>, config: VariantConfig, parent: WardicVariantContextValue | undefined): VariantNode => {
  const inherited = inheritedContext(config, parent)
  // A Variant child registers with the ancestor it joins, for its stagger slot and its `when`.
  const joined = UndefinedOr.map(inherited, (context) => ({ context, registration: context.register() }))
  if (Predicate.isNotUndefined(joined)) onCleanup(joined.registration.dispose)
  const own = Bool.match(hasOwnVariants(config), {
    onFalse: constUndefined,
    onTrue: () => ownOrchestration(cfg, config, parent, inherited),
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
  }
}
