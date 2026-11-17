/**
 * An element's place in variant orchestration on Foldkit (ADR-0007, #50; ADR-0071 decisions 17 and
 * 21): Solid's `variant-node.ts` over the `Reactivity` port's getters, with no reactive graph. The
 * rules it runs are core's `unstable/VariantTree`. What Solid keeps in memos is read on each ask here:
 * the names handed down, the orchestration, the stagger; what a Solid effect did at a trigger (the
 * slots marked stale, the names waiting again, `beforeChildren` waiting again) is done on the first
 * read after the trigger key changes, so a child's Retarget in the same patch reads a fresh slot. A
 * settle that changes a gate (`beforeChildren`, `afterChildren`) tells the port's watches to re-check,
 * which is how a held Retarget is released.
 *
 * @module
 */
import * as AnimationControls from "@wardic/core/unstable/AnimationControls"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as VariantTarget from "@wardic/core/unstable/VariantTarget"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, constVoid } from "effect/Function"
import * as MutableRef from "effect/MutableRef"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/** An element's place in variant orchestration, on the client. */
export interface VariantNode {
  /** What its children read: its own context, its parent's passed through, or none. */
  readonly provided: VariantTree.WardicVariantContextValue | undefined
  /** The context its spine inherits names and its default transition from: its parent's, for a Variant child. */
  readonly inherited: VariantTree.WardicVariantContextValue | undefined
  /** Its stagger delay in seconds, as a Variant child; `undefined` for any other element. */
  readonly extraDelay: ((name: string | undefined) => number) | undefined
  /** Whether its spine may start a Retarget: its ancestor's `beforeChildren` and its own `afterChildren` allow it. */
  readonly canStart: () => boolean
  /** Its spine's settle report on each frame: to its ancestor's registry, and to its own `beforeChildren`. */
  readonly onFrame: (done: boolean) => void
  /** A list's names orchestrated each on their own (#297's PR 2). Only an element that joins a provider or provides has one. */
  readonly names: VariantTree.NameOrchestration | undefined
  /**
   * Which of its element's gestures are on (#291, #793), read into the names it hands its Variant
   * children: bound by the element's Mount. Nothing for an element with no variants of its own, which
   * hands down what it takes.
   */
  readonly bindGestures: (states: () => VariantTree.GestureStates) => void
  /** Its registration with the ancestor it joined, given up: at its element's release. */
  readonly dispose: () => void
}

/** The orchestration an element with variants of its own runs for its Variant children. */
interface OwnOrchestration {
  readonly context: VariantTree.WardicVariantContextValue
  readonly canStart: () => boolean
  readonly settled: (done: boolean) => void
  readonly canStartFor: (name: string) => boolean
  readonly settledFor: (names: ReadonlyArray<string>, done: boolean) => void
  readonly bindGestures: (states: () => VariantTree.GestureStates) => void
}

/** No gesture on: what an element hands down before its Mount binds its gestures. */
const noGestures = (): VariantTree.GestureStates => VariantTree.NO_GESTURE_STATES

/** A registered Variant child's stagger slot, as its ancestor's registry holds it: set at each trigger. */
interface ChildRecord {
  index: number
  total: number
  /** The names of a list whose keys it has settled since the list last changed (#297's PR 2). */
  readonly names: Set<string>
}

/** No Controls change (#433): Animation controls aren't on Foldkit yet. */
const NO_CHANGE: AnimationControls.ControlsChange | undefined = undefined

/**
 * The registry, stagger and `when` an element with variants of its own runs for its Variant children
 * (ADR-0007), and the names it hands them. `notify` re-checks the port's watches: called when a gate
 * a child waits on changes.
 */
const ownOrchestration = (
  cfg: () => VariantTree.VariantConfig,
  parent: VariantTree.WardicVariantContextValue | undefined,
  inherited: VariantTree.WardicVariantContextValue | undefined,
  notify: () => void,
): OwnOrchestration => {
  const config = cfg()
  // Children in mount order (a Set keeps insertion order); the slots are rewritten at each trigger.
  const records = new Set<ChildRecord>()
  let unsettled = 0
  // The names of a list whose own keys have settled since the list last changed (#297's PR 2).
  const ownNames = new Set<string>()
  // True once this element's own animation settles; false again at each trigger. Drives `beforeChildren`.
  let ownSettled = false

  // The names handed down. `animate`'s is read on each ask; `initial`'s is read once.
  const variant = (): WardConfig.WardicVariantLabels | undefined => {
    const c = cfg()
    return VariantTree.handedDown(c, () => VariantTree.nameOf(c.animate), () => UndefinedOr.map(parent, (p) => p.variant()))
  }
  // What it hands down for its gestures (#291): which of its own are on, bound by its element's Mount (#793), and what it inherits, passed on.
  const ownStates = MutableRef.make<() => VariantTree.GestureStates>(noGestures)
  const gestures = (): VariantTree.GestureHandDown => VariantTree.handDownOf(cfg(), MutableRef.get(ownStates)(), VariantTree.handDownFrom(inherited))
  const triggerKey = (): string => VariantTree.triggerKeyOf(variant(), gestures(), NO_CHANGE)

  // Snapshot-at-trigger (ADR-0007): each child's index and total are recomputed only when a trigger
  // (this element's variant, or its gestures' names) changes, so a mount, unmount or reorder
  // mid-transition doesn't reshuffle in-flight delays. The change is seen on the first read after it:
  // a child the same patch Retargets reads its slot before anything else of this element's runs.
  let stale = true
  let lastKey: string | undefined
  let at: VariantTree.ChangeAtTrigger | undefined
  const checkTrigger = (): void => {
    const next = triggerKey()
    if (next === lastKey) return
    lastKey = next
    at = VariantTree.changeAtTrigger(NO_CHANGE, next, at)
    stale = true
    // Each name waits again (#297's PR 2): its keys, and its children's, settle anew.
    ownNames.clear()
    records.forEach((record) => record.names.clear())
    // `beforeChildren` waits again at each trigger, until this element's own animation settles.
    ownSettled = false
  }
  const fresh = (): void => {
    checkTrigger()
    if (!stale) return
    stale = false
    const n = records.size
    let i = 0
    records.forEach((record) => {
      record.total = n
      record.index = i
      i++
    })
  }

  const register = (): VariantTree.WardicChildRegistration => {
    const record: ChildRecord = { index: 0, total: 1, names: new Set() }
    let settled = false
    records.add(record)
    unsettled++
    const setSettled = (done: boolean): void => {
      if (done === settled) return
      settled = done
      const before = unsettled
      unsettled += Bool.match(done, { onTrue: () => -1, onFalse: () => 1 })
      // `afterChildren`'s gate changed: what waits on it re-checks.
      if (before === 0 || unsettled === 0) notify()
    }
    const dispose = (): void => {
      if (!records.delete(record)) return
      if (!settled) {
        unsettled--
        if (unsettled === 0) notify()
      }
      stale = true
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

  // Its orchestration (#277, #291, Motion's): the own transition of its highest active gesture's name,
  // else of its target (the variant it names), else its `transition`.
  const orchestration = (): WardConfig.WardicTransition | undefined => {
    checkTrigger()
    return VariantTree.orchestrationAt(UndefinedOr.getOrThrow(at), () => {
      const c = cfg()
      const own = UndefinedOr.match(VariantTree.topGestureName(VariantTree.activeNamesOf(gestures())), {
        onDefined: (name) => VariantTarget.ownTransitionOf(undefined, name, c.variants as WardConfig.WardicVariants | undefined, c.custom),
        onUndefined: () => VariantTarget.ownTransitionOf(c.animate as VariantTarget.Entry, variant(), c.variants as WardConfig.WardicVariants | undefined, c.custom),
      })
      return VariantTarget.transitionOfTarget(own, c.transition)
    })
  }
  const stagger = (): VariantTree.WardicStaggerConfig => VariantTree.staggerOf(orchestration())
  // A list's names have each their own (#297's PR 2): none for the list as a whole.
  const when = (): "beforeChildren" | "afterChildren" | undefined => {
    if (Arr.isArray(variant())) return undefined
    return UndefinedOr.map(orchestration(), (t) => t.when)
  }
  const initial = VariantTree.handedDown<WardConfig.WardicVariantLabels | false>(config, () => VariantTree.initialNameOf(config.initial), () => UndefinedOr.map(parent, (p) => p.initial))

  // Each name's orchestration for the Variant children's keys of that name (#297): its own transition's,
  // else the element's. Kept per name until the config changes.
  let byName = new Map<string, VariantTree.NameConfig>()
  let byNameFor: VariantTree.VariantConfig | undefined
  const configOf = (name: string): VariantTree.NameConfig => {
    checkTrigger()
    const changed = VariantTree.changeConfigOf(UndefinedOr.getOrThrow(at))
    if (Predicate.isNotUndefined(changed)) return changed
    const c = cfg()
    if (c !== byNameFor) {
      byNameFor = c
      byName = new Map()
    }
    const kept = byName.get(name)
    if (Predicate.isNotUndefined(kept)) return kept
    const made = VariantTree.nameConfigOf(VariantTarget.transitionOfTarget(VariantTarget.ownTransitionOf(undefined, name, c.variants as WardConfig.WardicVariants | undefined, c.custom), c.transition))
    byName.set(name, made)
    return made
  }
  const staggerFor = (name: string | undefined): VariantTree.WardicStaggerConfig => {
    if (Predicate.isUndefined(name)) return stagger()
    return configOf(name).stagger
  }
  const mayStartFor = (name: string): boolean => Bool.or(configOf(name).when !== "beforeChildren", ownNames.has(name))
  const canStartFor = (name: string): boolean => {
    if (configOf(name).when !== "afterChildren") return true
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

  const childrenMayStart = (): boolean => {
    checkTrigger()
    return when() !== "beforeChildren" || ownSettled
  }
  const allChildrenSettled = (): boolean => unsettled === 0
  // The transition its children default to: its own, else the one it inherits.
  const transition = (): WardConfig.WardicTransition | undefined => VariantTree.ownOrInherited(cfg().transition, inherited)

  return {
    context: { variant, initial, transition, gestures, register, stagger, staggerFor, mayStartFor, when, childrenMayStart, allChildrenSettled },
    // It holds its own start for `afterChildren` (it owns the registry, so it reads it directly).
    canStart: () => when() !== "afterChildren" || allChildrenSettled(),
    settled: (done) => {
      checkTrigger()
      if (done === ownSettled) return
      ownSettled = done
      // `beforeChildren`'s gate changed: the children waiting on it re-check.
      if (when() === "beforeChildren") notify()
    },
    canStartFor,
    settledFor,
    bindGestures: (states) => {
      MutableRef.set(ownStates, states)
    },
  }
}

/**
 * An element's place in variant orchestration on the client, from its config (read on each ask) and
 * the context the nearest Wardic ancestor provides. `notify` re-checks the port's watches.
 */
export const variantNodeOf = (cfg: () => VariantTree.VariantConfig, parent: VariantTree.WardicVariantContextValue | undefined, notify: () => void): VariantNode => {
  const config = cfg()
  const inherited = VariantTree.inheritedContext(config, parent)
  // A Variant child registers with the ancestor it joins, for its stagger slot and its `when`.
  const joined = UndefinedOr.map(inherited, (context) => ({ context, registration: context.register() }))
  const own = Bool.match(VariantTree.hasOwnVariants(config), {
    onFalse: constUndefined,
    onTrue: () => ownOrchestration(cfg, parent, inherited, notify),
  })
  // The spine reports on every frame (the per-frame path): both reports resolved once, two plain calls a frame.
  const reportJoined: (done: boolean) => void = UndefinedOr.match(joined, { onUndefined: () => constVoid, onDefined: ({ registration }) => registration.setSettled })
  const reportOwn: (done: boolean) => void = UndefinedOr.match(own, { onUndefined: () => constVoid, onDefined: (o) => o.settled })
  return {
    provided: UndefinedOr.match(own, { onDefined: (o) => o.context, onUndefined: () => VariantTree.passedThrough(config, parent) }),
    inherited,
    extraDelay: UndefinedOr.map(joined, ({ context, registration }) => (name: string | undefined) => {
      const s = VariantTree.staggerOfName(context, name)
      const n = registration.total()
      return VariantTree.childDelayOf(s, registration.index(), n)
    }),
    canStart: () =>
      UndefinedOr.match(inherited, { onUndefined: constTrue, onDefined: (context) => context.childrenMayStart() }) &&
      UndefinedOr.match(own, { onUndefined: constTrue, onDefined: (o) => o.canStart() }),
    onFrame: (done) => {
      reportJoined(done)
      reportOwn(done)
    },
    names: namesOf(joined, own),
    bindGestures: UndefinedOr.match(own, { onUndefined: () => constVoid, onDefined: (o) => o.bindGestures }),
    dispose: UndefinedOr.match(joined, { onUndefined: () => constVoid, onDefined: ({ registration }) => registration.dispose }),
  }
}

/** Its spine's per-name orchestration (#297's PR 2), as Solid's. None for an element that joins nothing and provides nothing. */
const namesOf = (
  joined: { readonly context: VariantTree.WardicVariantContextValue; readonly registration: VariantTree.WardicChildRegistration } | undefined,
  own: OwnOrchestration | undefined,
): VariantTree.NameOrchestration | undefined => {
  if (Bool.and(Predicate.isUndefined(joined), Predicate.isUndefined(own))) return undefined
  const tell = (names: ReadonlyArray<string>, done: boolean): void => {
    UndefinedOr.map(joined, ({ registration }) => UndefinedOr.map(registration.setSettledFor, (set) => Arr.forEach(names, (name) => set(name, done))))
    UndefinedOr.map(own, (o) => o.settledFor(names, done))
  }
  return {
    mayStart: (name) =>
      Bool.and(
        UndefinedOr.match(joined, { onUndefined: constTrue, onDefined: ({ context }) => VariantTree.mayStartOf(context, name) }),
        UndefinedOr.match(own, { onUndefined: constTrue, onDefined: (o) => o.canStartFor(name) }),
      ),
    moving: (names) => tell(names, false),
    settled: (names) => tell(names, true),
  }
}
