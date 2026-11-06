/**
 * A Retarget's legs as one pure builder (#48, ADR-0044 decision 8): which machines a Retarget
 * runs, each from where and on which transition, with nothing of the element's (its gate, its
 * Snapshot, its fibers). The spine runs each leg into its sinks; a server render samples a mount's
 * legs into an Appear animation's rule, so the two can't drift.
 *
 * - **Which transition** (ADR-0051, #357): a key runs on the transition it resolves to (#301), as
 *   Motion's: with none defined there, on its Environment's Default transition for it ({@link runOf}).
 * - **A tween** runs every key, numbers and strings, in one `animateValues` leg; with a key's
 *   Keyframes among them (#429, ADR-0058), or `times` or an `ease` per Interval, in one
 *   `keyframesValues` leg.
 * - **A spring** runs the numbers in one `springValues` leg, carrying velocity, and the strings in
 *   one `springBlend` leg on the same spring (ADR-0024, D5). It takes two stops: Keyframes of more
 *   are Motion's error, and land on their last stop.
 * - **Keyframes of two stops** run as a target does, from their first stop ({@link keyframesFrom}).
 * - **A Measured pair** (#430, `@wardic/dom/MeasuredPair`) runs in a leg of its own, between its ends
 *   in px, measured at the end of the task, and lands on its target as given.
 * - **Reduced motion** (ADR-0029): when it applies, the positional keys snap in a leg of their own,
 *   after the delay their transition gives, to where their leg would have ended.
 * - **A return to a moving Live value** (#130, ADR-0043 decision 6) runs a leg of its own per key,
 *   a tween easing toward it, a spring chasing it.
 *
 * The legs come in the order the spine starts them: the snap, the follows, then the rest. A leg's
 * machine is built when it's called, inside the leg's own fiber, so a transition core rejects
 * fails that leg alone (#66).
 */
import type * as Arc from "@wardic/core/Arc"
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as Inertia from "@wardic/core/Inertia"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Spring from "@wardic/core/Spring"
import * as Values from "@wardic/core/Values"
import * as MeasuredPair from "@wardic/dom/MeasuredPair"
import type * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { identity, type LazyArg } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition } from "./config.ts"

/** A Retarget's returns that follow a moving Live value (#130, ADR-0043 decision 6). */
export interface Follows {
  /** The keys among the animated ones whose return follows its Live value. */
  readonly keysOf: (rest: Values.Values) => ReadonlyArray<string>
  /** Where a following key's Live value is now, read each step. */
  readonly targetOf: (key: string, start: number) => () => number
}

/** A leg that snaps the positional keys (ADR-0029). */
export interface Snap {
  readonly _tag: "Snap"
  /** The keys it snaps: a spring starts each of them at rest after. */
  readonly keys: ReadonlyArray<string>
  /** Each key it snaps, with the target the Retarget gave it (#325). */
  readonly to: Values.Values
  readonly machine: () => Machine.Machine<Frame.Frame<Values.Values>>
}

/** A leg that follows one key's moving Live value (#130). */
export interface Follow {
  readonly _tag: "Follow"
  readonly key: string
  /** Its key, with where its Live value was at the Retarget (#325). */
  readonly to: Values.Values
  readonly machine: () => Machine.Machine<Frame.Frame<number> & { readonly velocity?: number }>
}

/** A leg over the numeric keys, carrying their velocities: a spring's. */
export interface Numbers {
  readonly _tag: "Numbers"
  /** Each key it animates, with its target (#325). */
  readonly to: Values.Values
  readonly machine: () => Machine.Machine<Frame.MultiPhysics>
}

/** A leg over values through the Interpolators: a tween's keys, or a spring's strings. */
export interface Blend {
  readonly _tag: "Blend"
  /** Each key it animates, with its target (#325). */
  readonly to: Values.Values
  readonly machine: () => Effect.Effect<Machine.Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry>
}

/** One leg of a Retarget. */
export type Leg = Snap | Follow | Numbers | Blend

/**
 * Each key's velocity now (#464): read only for a key a spring or a follow starts, so a tween's
 * Retarget reads none. A spring takes its transition's own `velocity` over it, as Motion's
 * `{ velocity: value.getVelocity(), ...valueTransition }`.
 */
export type Velocities = (key: string) => number

/** No velocity: every key at rest. */
export const NO_VELOCITY: Velocities = () => 0

/** Each key's velocity from a record of them, 0 for one it doesn't have. */
export const velocitiesOf = (record: Readonly<Record<string, number>>): Velocities => (key) => {
  const velocity = record[key]
  if (Predicate.isUndefined(velocity)) return 0
  return velocity
}

/**
 * The fields no machine reads: the orchestration's (ADR-0007), the variant tree's, and a Path
 * (#438), which {@link legsOf} takes out to `x` and `y`'s leg. Neither defines a transition.
 */
const ORCHESTRATION = ["staggerChildren", "delayChildren", "from", "staggerDirection", "when", "path"] as const

/** A transition as a machine takes it: without the orchestration's fields (#243) or its Path (#438), each arm. */
export type MotionTransition = WardicTransition extends infer T ? (T extends unknown ? Omit<T, (typeof ORCHESTRATION)[number]> : never) : never

/** Each transition without its orchestration, by the transition: one object each, so core's decode cache hits (#66). */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const MOTIONS = new WeakMap<WardicTransition, MotionTransition>()

/**
 * A transition as its machines take it: without the orchestration's fields (#243). A stagger's
 * `from` (`"last"`, `"center"`) is the variant tree's, and a spring decodes `from` as its starting
 * position, so it failed every leg; the rest of those fields a machine ignores. The same transition,
 * one with none of them.
 */
export const motionOf = (transition: WardicTransition | undefined): MotionTransition | undefined =>
  UndefinedOr.map(transition, (t): MotionTransition =>
    Bool.match(Arr.some(ORCHESTRATION, (key) => Object.hasOwn(t, key)), {
      onFalse: () => t as MotionTransition,
      onTrue: () =>
        Option.getOrElse(Option.fromUndefinedOr(MOTIONS.get(t)), () => {
          const motion = Rec.filter(t as Record<string, unknown>, (_, key) => Bool.not(Arr.contains(ORCHESTRATION, key))) as MotionTransition
          MOTIONS.set(t, motion)
          return motion
        }),
    }))

// --- Per-value transitions (#301, Motion's `getValueTransition`) ---------------------------

/**
 * A transition's entries (#301): its own fields, and each value's entry (`default` and `layout`
 * among them). Each entry is resolved at its first need and kept, so its keys run on the same object
 * at every Retarget (#66's decode cache keys on it).
 */
interface Entries {
  readonly own: WardicTransition
  readonly byKey: Readonly<Record<string, WardicTransition>>
  /** Whether any entry is a value's, not `default` or `layout`: else every value runs on one transition. */
  readonly byValue: boolean
  readonly resolved: Map<string, WardicTransition>
}

/** A transition with no entry: what nearly every transition is. */
const NONE: unique symbol = Symbol("wardic.noEntries")

/** Each transition's entries, worked out once per object (#301). */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const ENTRIES = new WeakMap<object, Entries | typeof NONE>()

/** The entries that aren't a value's. */
const NOT_VALUES: ReadonlySet<string> = new Set(["default", "layout"])

/**
 * Whether a field is an entry (#301): a transition, under a value's name, `default` or `layout`. No
 * option of a transition's own is a plain object: an easing is a function, `times` an array.
 */
const isEntry = (value: unknown): boolean => Predicate.isObject(value)

/**
 * A transition's entries (#301), or `undefined` for one with none: worked out once per transition
 * object, so an element whose transitions have none pays a lookup per Retarget.
 */
export const entriesOf = (given: WardicTransition | undefined): Entries | undefined => {
  if (Predicate.isUndefined(given)) return undefined
  const known = ENTRIES.get(given)
  if (known === NONE) return undefined
  if (Predicate.isNotUndefined(known)) return known
  const fields = given as Readonly<Record<string, unknown>>
  const keys = Arr.filter(Rec.keys(fields), (key) => isEntry(fields[key]))
  if (keys.length === 0) {
    ENTRIES.set(given, NONE)
    return undefined
  }
  const made: Entries = {
    own: Rec.filter(fields, (value) => Bool.not(isEntry(value))) as WardicTransition,
    byKey: Rec.fromEntries(Arr.map(keys, (key) => [key, fields[key] as WardicTransition] as const)),
    byValue: Arr.some(keys, (key) => Bool.not(NOT_VALUES.has(key))),
    resolved: new Map(),
  }
  ENTRIES.set(given, made)
  return made
}

/**
 * The transition `key` runs on (#301, Motion's `getValueTransition`): its entry, else `default`, else
 * the transition's own fields; an entry with `inherit: true` laid over the own fields, its own winning.
 * The reduced-motion opt-out is the whole transition's, as the orchestration is: an entry without
 * its own takes the top level's.
 */
const forKey = (entries: Entries, key: string): WardicTransition => {
  if (Object.hasOwn(entries.byKey, key)) return entryNamed(entries, key)
  if (Object.hasOwn(entries.byKey, "default")) return entryNamed(entries, "default")
  return entries.own
}

/** The entry `name` resolved, once: every key on it runs on the one object, so they share a leg. */
const entryNamed = (entries: Entries, name: string): WardicTransition => {
  const kept = entries.resolved.get(name)
  if (Predicate.isNotUndefined(kept)) return kept
  const made = resolvedEntry(entries.own, entries.byKey[name] as WardicTransition)
  entries.resolved.set(name, made)
  return made
}

/**
 * An entry as its key runs on it (#301): over the own fields with `inherit`, else with their
 * reduced-motion opt-out and their `skipAnimations` alone (#468: Motion skips every value of a
 * transition that says so).
 */
const resolvedEntry = (own: WardicTransition, entry: WardicTransition): WardicTransition => {
  const { inherit, ...rest } = entry as WardicTransition & { readonly inherit?: boolean }
  if (inherit === true) return { ...own, ...rest } as WardicTransition
  let made = rest as WardicTransition
  if (Bool.and(Predicate.isNotUndefined(own.respectReducedMotion), Predicate.isUndefined(rest.respectReducedMotion))) made = { ...made, respectReducedMotion: own.respectReducedMotion } as WardicTransition
  if (own.skipAnimations === true) made = { ...made, skipAnimations: true } as WardicTransition
  return made
}

/**
 * The transition `key` runs on in `given` (#301): its entry, else `default`, else `given`'s own
 * fields. `given` itself when it has no entry.
 */
export const transitionForKey = (given: WardicTransition | undefined, key: string): WardicTransition | undefined => {
  const entries = entriesOf(given)
  if (Predicate.isUndefined(entries)) return given
  return forKey(entries, key)
}

/**
 * `given` held back by `extra` more seconds (ADR-0007's stagger, #290's exit delays): its own `delay`,
 * and each entry's (#301), so a key on its entry waits as the rest do. An `inherit` entry with no
 * `delay` of its own takes the own fields' as they are.
 */
export const delayedBy = (given: WardicTransition | undefined, extra: number): WardicTransition | undefined => {
  if (extra === 0) return given
  const own = { ...given, delay: delayIn(given) + extra } as WardicTransition
  const entries = entriesOf(given)
  if (Predicate.isUndefined(entries)) return own
  return {
    ...own,
    ...Rec.map(entries.byKey, (entry) => {
      const fields = entry as WardicTransition & { readonly inherit?: boolean }
      if (Bool.and(fields.inherit === true, Predicate.isUndefined(fields.delay))) return entry
      return { ...entry, delay: delayIn(entry) + extra }
    }),
  } as WardicTransition
}

/** A transition's `delay`, 0 without one. */
const delayIn = (transition: WardicTransition | undefined): number =>
  UndefinedOr.match(transition, { onUndefined: () => 0, onDefined: (t) => UndefinedOr.match(t.delay, { onUndefined: () => 0, onDefined: identity }) })

// --- A transition as its legs run it (ADR-0051, #357) -----------------------------------------

/**
 * A transition as its legs run it: a spring or a tween, Motion's fields filled in (ADR-0051), with
 * its reduced-motion opt-out.
 */
export type Run = (DefaultTransition.Transition | DefaultTransition.KeyframesTransition | InertiaRun) & { readonly respectReducedMotion?: boolean; readonly skipAnimations?: boolean }

/** An inertia as its legs run it (#435): core's options, `timeConstant` in seconds, with the transition's `velocity` and `delay`. */
export type InertiaRun = Machine.InertiaValuesOptions & { readonly type: "inertia" }

/** Each key's stops past its first two (#429): the Keyframes a tween runs through `keyframesValues`. */
export type StopsByKey = Readonly<Record<string, ReadonlyArray<number | string>>>

/**
 * Whether `key` has Keyframes of more than two stops among `stops`: never a Measured pair (#430). They
 * run through their stops, switching where types mix, as Motion's measures two stops only (#460).
 */
export const hasManyStops = (stops: StopsByKey | undefined, key: string): boolean => {
  if (Predicate.isUndefined(stops)) return false
  return Object.hasOwn(stops, key)
}

/** Where a Retarget's keys start, and each one's stops, its Keyframes resolved ({@link keyframesFrom}). */
export interface KeyframesStart {
  readonly from: Values.Values
  readonly stops: StopsByKey | undefined
}

/**
 * Where a target's keys start with its **Keyframes** resolved (#429, Motion's): a first `null` stop is
 * where the key is (`from`), each later one the stop before (`fillWildcards`), and an explicit first
 * stop is where it starts, jumped to. `stops` holds the keys with more than two: a key with two runs
 * as a target does, from its first, so a spring takes it with the key's velocity, as Motion's.
 *
 * @param from each key's start
 * @param to each key's target, its Keyframes' last stop
 * @param keyframes each Keyframes key's stops; only the keys `to` has are read
 */
export const keyframesFrom = (from: Values.Values, to: Values.Values, keyframes: Readonly<Record<string, Style.Stops>>): KeyframesStart => {
  const started: Record<string, number | string> = { ...from }
  let many: Record<string, ReadonlyArray<number | string>> | undefined
  Arr.forEach(Rec.keys(keyframes), (key) => {
    if (Bool.not(Object.hasOwn(to, key))) return
    const filled = filledStops(UndefinedOr.getOrThrow(keyframes[key]), UndefinedOr.getOrThrow(from[key]))
    started[key] = UndefinedOr.getOrThrow(filled[0])
    if (filled.length < 3) return
    if (Predicate.isUndefined(many)) many = {}
    many[key] = filled
  })
  return { from: started, stops: many }
}

/**
 * Stops with each `null` filled (#429, Motion's `fillWildcards`): the first with `start`, a later one
 * with the stop before. A sequence's function Segment fills its own from 0 (#433).
 */
export const filledStops = (stops: Style.Stops, start: number | string): ReadonlyArray<number | string> => {
  let before = start
  return Arr.map(stops, (stop) => {
    if (Predicate.isNotNull(stop)) before = stop
    return before
  })
}

/**
 * Why Keyframes of more than two stops can't run on a spring (#429): Motion's development error
 * ("Only two keyframes currently supported with spring and inertia animations"), naming each key, its
 * stops and the fix.
 */
const springStopsError = (stops: StopsByKey, kind = "a spring"): Error =>
  new Error(
    `wardic: ${Arr.map(Rec.toEntries(stops), ([key, list]) => `"${key}" has ${list.length} keyframes`).join(", ")}, and ${kind} takes two, as Motion's does (#429). ` +
      `Run them on a tween: transition: { ${Arr.map(Rec.keys(stops), (key) => `${JSON.stringify(key)}: { type: "tween" }`).join(", ")} }.`,
  )

/** Each tween's answer to {@link keyframedOptions}, by its options: one object each, as {@link RUNS}' (#452). */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const KEYFRAMED = new WeakMap<object, boolean>()

/**
 * Whether a tween's options need `keyframesValues` (#429): `times`, or an `ease` per Interval, which
 * `animateValues` doesn't take. Worked out once per options object (#452): every tween Retarget asks.
 */
const keyframedOptions = (options: Machine.KeyframesOptions): boolean => {
  const known = KEYFRAMED.get(options)
  if (Predicate.isNotUndefined(known)) return known
  const keyframed = Bool.or(Predicate.isNotUndefined(options.times), Bool.and(Arr.isArray(options.ease), Bool.not(Easing.isBezier(options.ease as Easing.Definition))))
  KEYFRAMED.set(options, keyframed)
  return keyframed
}

/**
 * The spring fields: one of them, with no `type`, makes a transition a spring, a value's or a layout
 * animation's (ADR-0009 *Amendment (#171)*, ADR-0051); a time-based spring's `bounce` and
 * `visualDuration` among them (#359), where a `duration` alone is a tween's.
 */
export const SPRING_FIELDS = ["stiffness", "damping", "mass", "velocity", "restDelta", "restSpeed", "bounce", "visualDuration"] as const

/** A spring's physics fields: one of them wins over its time (#359, Motion's `physicsKeys`). */
const PHYSICS_FIELDS = ["stiffness", "damping", "mass"] as const

/** A time-based spring's fields (#359): with no physics field, core solves its physics from them. */
const TIME_FIELDS = ["duration", "bounce", "visualDuration"] as const

/**
 * The fields that don't define a transition, beside the orchestration's ({@link motionOf}): Motion's
 * `isTransitionDefined` (at 16c6122) skips `delay`; Wardic's reduced-motion opt-out, `skipAnimations`
 * (#468) and a target's `inherit` aren't a transition's either. `repeat` and its fields do define one, a tween (ADR-0051).
 */
const NOT_DEFINING: ReadonlySet<string> = new Set(["delay", "respectReducedMotion", "skipAnimations", "inherit"])

/** Motion's spring defaults (`springDefaults`): what a spring transition leaves out (ADR-0051). */
const MOTION_SPRING = { stiffness: 100, damping: 10, mass: 1 } as const


/** A transition that defines nothing: its keys run on their Default transitions. */
const NOT_DEFINED: unique symbol = Symbol("wardic.notDefined")

/** Each transition as its legs run it, by the transition: one object each, so core's decode cache hits (#66). */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const RUNS = new WeakMap<object, Run | typeof NOT_DEFINED>()

/** A field a transition gives: set, and not an entry (#301). */
const isGiven = (value: unknown): boolean => Bool.and(Predicate.isNotUndefined(value), Bool.not(isEntry(value)))

/** Whether a field defines a transition. */
const isDefining = (key: string): boolean => Bool.not(NOT_DEFINING.has(key))

/** Whether a transition gives any of `keys`. */
const givesAny = (fields: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): boolean => Arr.some(keys, (key) => Object.hasOwn(fields, key))

/** Whether a transition's fields make it a spring: `type: "spring"`, or no `type` and a spring field. */
const isSpring = (fields: Readonly<Record<string, unknown>>): boolean =>
  Bool.or(fields.type === "spring", Bool.and(Predicate.isUndefined(fields.type), givesAny(fields, SPRING_FIELDS)))

/**
 * Whether a spring transition is set by time (#359): a time field and no physics field. Its physics
 * are core's to solve, so it takes none of Motion's defaults, which would win over its time.
 */
const isTimed = (fields: Readonly<Record<string, unknown>>): boolean => Bool.and(givesAny(fields, TIME_FIELDS), Bool.not(givesAny(fields, PHYSICS_FIELDS)))

/** {@link runOf}'s work, once a transition: its given fields, and what they make. */
const madeRun = (given: WardicTransition): Run | typeof NOT_DEFINED => {
  const fields = Rec.filter(UndefinedOr.getOrThrow(motionOf(given)) as Readonly<Record<string, unknown>>, isGiven)
  if (Bool.not(Arr.some(Rec.keys(fields), isDefining))) return NOT_DEFINED
  // An inertia (#435): its fields as given, Motion's `timeConstant` in milliseconds as core's seconds.
  if (fields.type === "inertia") {
    return { ...fields, ...UndefinedOr.match(fields.timeConstant as number | undefined, { onUndefined: () => ({}), onDefined: (ms) => ({ timeConstant: ms / 1000 }) }) } as Run
  }
  return Bool.match(isSpring(fields), {
    onTrue: (): Run =>
      Bool.match(isTimed(fields), {
        onTrue: (): Run => ({ ...fields, type: "spring" }) as Run,
        onFalse: (): Run => ({ ...MOTION_SPRING, ...fields, type: "spring" }) as Run,
      }),
    onFalse: (): Run => ({ ease: Easing.easeOut, ...fields, type: "tween" }) as Run,
  })
}

/**
 * A transition as its legs run it (ADR-0051, #357), or `undefined` when it isn't defined: none, or
 * one with only orchestration, `delay` and the reduced-motion opt-out (Motion's
 * `isTransitionDefined`). A defined one:
 * - is a spring when it says so, or gives no `type` and a spring field ({@link SPRING_FIELDS});
 *   anything else is a tween, as a layout animation's is (ADR-0009 *Amendment (#171)*): `{ duration:
 *   0.5 }` a 0.5 s tween, as Motion's, where `{ stiffness: 300 }` stays a spring;
 * - takes Motion's fields for those it leaves out: a spring's 100 / 10 / 1, a tween's `easeOut`
 *   (a tween's 0.3 s is core's too). A spring set by time, a `duration`, `bounce` or
 *   `visualDuration` and no stiffness, damping or mass (#359), takes no physics: core solves them.
 *
 * Worked out once per transition object. A field set to `undefined` gives nothing.
 */
export const runOf = (given: WardicTransition | undefined): Run | undefined => {
  if (Predicate.isUndefined(given)) return undefined
  let run = RUNS.get(given)
  if (Predicate.isUndefined(run)) {
    run = madeRun(given)
    RUNS.set(given, run)
  }
  if (run === NOT_DEFINED) return undefined
  return run
}

/** No keys: a Retarget with no following return. */
const NO_KEYS: ReadonlyArray<string> = []

/** Whether a value map has any key. */
const hasKeys: Predicate.Predicate<Values.Values> = Predicate.not(Rec.isEmptyRecord)

/**
 * A Retarget's legs, in the order the spine starts them. Positional, as the spine calls it once a
 * Retarget per element (#69's PR 2: what a Retarget allocates shows in `bench:solid`'s bytes).
 *
 * @param from each key's start
 * @param to each key's target
 * @param given the transition the legs run on, any stagger delay folded in (ADR-0007); its orchestration
 *   fields are left out ({@link motionOf})
 * @param reducedMotion whether reduced motion is on (the provider's, ADR-0029); a transition can still opt out
 * @param skipped whether its animations are skipped (#468, a `WardicConfig`'s `skipAnimations`): every key
 *   lands at its end on the first tick; a transition's `skipAnimations: true` does the same for its keys
 * @param positionalKeys which keys are positional: the Environment's (ADR-0036)
 * @param defaults what a key with no transition defined runs on: the Environment's (ADR-0051)
 * @param velocities each key's velocity now (#464): a spring starts from it, unless its transition gives one
 * @param follow the returns that follow a moving Live value (#130), given only when the Retarget returns a key
 * @param stops each key's Keyframes of more than two stops (#429, {@link keyframesFrom}), `from` at their first
 * @param measured each key's Measured pair (#430), measured at the end of the task
 * @param current where every key is now: a Path's axis the target leaves out starts there (#438)
 * @param rests where a Path's axis the target leaves out comes to rest, when a Path in flight was taking
 *   it somewhere (#574): it ends there; else where it starts
 */
/** A Path's two axes (#438). */
const AXES = ["x", "y"] as const

/**
 * A Retarget's keys with both of a Path's axes (#438): a Path couples `x` and `y`, so with either one
 * retargeted, the other goes along it too, to its own target in `target`, though that hasn't changed
 * and a Retarget otherwise keeps an unchanged key's Leg (#325). Without a Path, or neither axis, the
 * keys as they are.
 */
export const withPathAxes = (fresh: Values.Values, target: Values.Values, transition: WardicTransition | undefined): Values.Values => {
  if (Predicate.isUndefined(UndefinedOr.map(transition, (t) => t.path))) return fresh
  if (Bool.not(Arr.some(AXES, (key) => Object.hasOwn(fresh, key)))) return fresh
  const missing = Arr.filter(AXES, (key) => Bool.and(Bool.not(Object.hasOwn(fresh, key)), Object.hasOwn(target, key)))
  if (missing.length === 0) return fresh
  return { ...fresh, ...Rec.fromEntries(Arr.map(missing, (key) => [key, UndefinedOr.getOrThrow(target[key])] as const)) }
}

/** `key`'s number: from `values`, else from `current`, else its identity, 0; `undefined` for a string. */
const axisOf = (key: string, values: Values.Values, current: Values.Values | undefined): number | undefined => {
  const given = values[key]
  if (Predicate.isNumber(given)) return given
  if (Predicate.isNotUndefined(given)) return undefined
  const now = UndefinedOr.map(current, (all) => all[key])
  if (Predicate.isNumber(now)) return now
  if (Predicate.isNotUndefined(now)) return undefined
  return 0
}

/**
 * `x` and `y` along a Path (#438, Motion's `path`): one progress, 0 to 1, on the transition `x` runs
 * on, from rest, as Motion's `{ velocity: 0, ...getValueTransition(transition, "x") }`; a spring's over
 * 1000, as a layout animation's, so its rest thresholds read as at that distance (#344). Its frames
 * write both axes, and the path's turn (`pathRotation`) when it has one; its last, the targets and no turn.
 */
const pathLegOf = (at: (t: number) => Arc.PathPoint, end: Values.Values, transition: Run): Blend => ({
  _tag: "Blend",
  to: end,
  machine: () =>
    Effect.succeed(
      Machine.make({
        settles: Bool.or(transition.type === "spring", Number.isFinite(UndefinedOr.match((transition as Machine.Modifiers).repeat, { onUndefined: () => 0, onDefined: identity }))),
        span: { name: "wardic.path", attributes: { rotates: Object.hasOwn(end, "pathRotation") } },
        start: () => {
          const progress = progressOf(transition)
          const turns = Object.hasOwn(end, "pathRotation")
          return (dt): Frame.Frame<Values.Values> => {
            const frame = progress(dt)
            if (frame.done) return { value: end, done: true }
            const point = at(frame.value)
            if (turns) return { value: { x: point.x, y: point.y, pathRotation: UndefinedOr.match(point.rotate, { onUndefined: () => 0, onDefined: identity }) }, done: false }
            return { value: { x: point.x, y: point.y }, done: false }
          }
        },
      }),
    ),
})

/** A Path's progress, 0 to 1, on `transition`: a spring's from rest over 1000 (#438), a tween's as a Measured pair's. */
const progressOf = (transition: Run): ((dt: number) => Frame.Frame<number>) => {
  if (transition.type === "spring") {
    const spring = Machine.springValues({ progress: 1000 }, { ...(transition as Machine.SpringOptions), velocity: 0 }, { from: { progress: 0 } }).start()
    return (dt) => {
      const frame = spring(dt)
      return { value: UndefinedOr.getOrThrow(frame.value.progress) / 1000, done: frame.done }
    }
  }
  return Machine.keyframes([0, 1], transition as Machine.KeyframesOptions).start()
}

/**
 * A Retarget's Path (#438): when its transition has one and its target has `x` or `y`, their leg along
 * it, from where they are (an axis it leaves out from where it is now, `current`), on the transition `x`
 * runs on; and the target without them. An axis it leaves out ends where it rests (#574): where the Path
 * in flight was taking it, in `rests`, so a toss caught mid-air curves back to its line; else back where
 * it starts, as Motion's `yTo = yRaw ?? yFrom`. `undefined` when there's none to take: no
 * Path or no axis, reduced motion snapping them, a Skipped animation, an inertia, an axis that isn't a
 * number. Keyframes' ends are their first and last stops.
 */
const pathOf = (
  from: Values.Values,
  to: Values.Values,
  given: WardicTransition | undefined,
  reducedMotion: boolean,
  skipped: boolean,
  defaults: DefaultTransition.DefaultTransition["Service"],
  stops: StopsByKey | undefined,
  current: Values.Values | undefined,
  rests: Values.Values | undefined,
): { readonly leg: Blend; readonly rest: Values.Values } | undefined => {
  // Every element's Retarget asks, nearly always with no `path` (#460): guards, nothing built.
  if (Predicate.isUndefined(given)) return undefined
  const path = given.path
  if (Predicate.isUndefined(path)) return undefined
  if (Bool.not(Arr.some(AXES, (key) => Object.hasOwn(to, key)))) return undefined
  if (Bool.or(skipped, UndefinedOr.map(given, (t) => t.skipAnimations) === true)) return undefined
  // `x`'s transition, as a key's: its own entry (#301), else the transition's, else its Default (ADR-0051).
  const runsOn = UndefinedOr.match(entriesOf(given), { onUndefined: () => given, onDefined: (entries) => forKey(entries, "x") })
  const run = UndefinedOr.match(runOf(runsOn), { onUndefined: () => carried(defaultFor(defaults, "x", to, stops), runsOn), onDefined: identity })
  if (run.type === "inertia") return undefined
  // Reduced motion snaps the positional keys, the axes among them (ADR-0029), unless it opts out.
  if (Bool.and(reducedMotion, run.respectReducedMotion !== false)) return undefined
  const startX = axisOf("x", from, current)
  if (Predicate.isUndefined(startX)) return undefined
  const startY = axisOf("y", from, current)
  if (Predicate.isUndefined(startY)) return undefined
  // An axis the target leaves out ends where it rests (#574), else where it starts.
  const resting: Values.Values = { x: startX, y: startY, ...rests }
  const endX = axisOf("x", to, resting)
  if (Predicate.isUndefined(endX)) return undefined
  const endY = axisOf("y", to, resting)
  if (Predicate.isUndefined(endY)) return undefined
  const at = path({ x: startX, y: startY }, { x: endX, y: endY })
  // A path that turns the element says so at its start, as Motion's `interpolate(0).rotate`.
  const end: Values.Values = Bool.match(Predicate.isUndefined(at(0).rotate), {
    onTrue: () => ({ x: endX, y: endY }),
    onFalse: () => ({ x: endX, y: endY, pathRotation: 0 }),
  })
  return { leg: pathLegOf(at, end, run), rest: Rec.filter(to, (_, key) => Bool.not(Arr.contains(AXES, key as "x"))) }
}

export const legsOf = (
  from: Values.Values,
  to: Values.Values,
  given: WardicTransition | undefined,
  reducedMotion: boolean,
  skipped: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  defaults: DefaultTransition.DefaultTransition["Service"],
  velocities: Velocities,
  follow?: Follows | undefined,
  stops?: StopsByKey | undefined,
  measured?: MeasuredPairs | undefined,
  current?: Values.Values | undefined,
  rests?: Values.Values | undefined,
): ReadonlyArray<Leg> => {
  // A Path (#438): `x` and `y` along it, on a leg of their own, and every other key as before.
  const pathed = pathOf(from, to, given, reducedMotion, skipped, defaults, stops, current, rests)
  if (Predicate.isNotUndefined(pathed)) {
    return Arr.prepend(legsOf(from, pathed.rest, given, reducedMotion, skipped, positionalKeys, defaults, velocities, follow, stops, measured), pathed.leg)
  }
  // Each key on its own transition (#301): with entries, the keys go by the transition each runs on.
  const entries = entriesOf(given)
  if (Predicate.isUndefined(entries)) return legsOn(from, to, given, reducedMotion, skipped, positionalKeys, defaults, velocities, follow, stops, measured)
  // With no value's entry (`layout` and `default` alone), every key runs on one transition.
  if (Bool.not(entries.byValue)) return legsOn(from, to, forKey(entries, "default"), reducedMotion, skipped, positionalKeys, defaults, velocities, follow, stops, measured)
  const byTransition = new Map<WardicTransition, Record<string, number | string>>()
  Arr.forEach(Rec.keys(to), (key) => {
    const runsOn = forKey(entries, key)
    const keys = byTransition.get(runsOn)
    if (Predicate.isNotUndefined(keys)) {
      keys[key] = to[key] as number | string
      return
    }
    byTransition.set(runsOn, { [key]: to[key] as number | string })
  })
  return Arr.flatMap(Arr.fromIterable(byTransition), ([runsOn, keys]) => legsOn(from, keys, runsOn, reducedMotion, skipped, positionalKeys, defaults, velocities, follow, stops, measured))
}

/** No legs: a Retarget with no key. */
const NO_LEGS: ReadonlyArray<Leg> = []

/** Each key's Measured pair (#430), by its key. */
export type MeasuredPairs = Readonly<Record<string, MeasuredPair.Requested>>

/** Whether any key of `values` is a Measured pair (#430): per Retarget, so nothing made. */
const anyMeasured = (values: Values.Values, measured: MeasuredPairs | undefined): boolean => {
  if (Predicate.isUndefined(measured)) return false
  return Rec.some(values, (_, key) => Object.hasOwn(measured, key))
}

/**
 * Measured pairs' leg (#430): their ends in px, read at its first step, which comes a tick after the
 * end-of-task batch that measures them. A tween runs a 0 → 1 progress (`keyframes`' options, so
 * `times`, an `ease` per Interval and the Modifiers apply), a spring the px. Its last frame writes each
 * target as given (`"auto"`, `"50%"`), as Motion's `finalKeyframe`, or each start as given when a turned
 * `repeat` ends it there. A pair its batch couldn't read switches, as a Discrete pair does.
 */
const measuredLegOf = (pairs: MeasuredPairs, transition: Run): Blend => {
  const to = Rec.map(pairs, (pair) => pair.to)
  return { _tag: "Blend", to, machine: () => Effect.succeed(measuredMachine(pairs, to, transition)) }
}

/** {@link measuredLegOf}'s machine: its step made at the first step, once the pairs are measured. */
const measuredMachine = (pairs: MeasuredPairs, to: Values.Values, transition: Run): Machine.Machine<Frame.Frame<Values.Values>> =>
  Machine.make({
    settles: Bool.or(transition.type === "spring", Number.isFinite(UndefinedOr.match((transition as Machine.Modifiers).repeat, { onUndefined: () => 0, onDefined: identity }))),
    span: { name: "wardic.measured", attributes: { keys: Rec.keys(pairs).length } },
    start: () => {
      let step: ((dt: number) => Frame.Frame<Values.Values>) | undefined
      return (dt) => {
        if (Predicate.isUndefined(step)) step = measuredStep(pairs, to, transition)
        return step(dt)
      }
    },
  })

/** {@link measuredMachine}'s step, its pairs measured, or a switch when its batch couldn't read one. Per frame: one Frame a step. */
const measuredStep = (pairs: MeasuredPairs, to: Values.Values, transition: Run): ((dt: number) => Frame.Frame<Values.Values>) => {
  const all = Option.all(Rec.map(pairs, MeasuredPair.measured))
  if (Option.isNone(all)) return () => ({ value: to, done: true })
  const fromPx = Rec.map(all.value, (pair) => pair.fromPx)
  const toPx = Rec.map(all.value, (pair) => pair.toPx)
  if (transition.type === "spring") {
    const spring = Machine.springValues(toPx, transition as Machine.SpringOptions, { from: fromPx }).start()
    return (dt) => {
      const frame = spring(dt)
      if (frame.done) return { value: to, done: true }
      return { value: frame.value, done: false }
    }
  }
  const options = transition as Machine.KeyframesOptions
  const progress = Machine.keyframes([0, 1], options).start()
  // A turned `repeat` can end it at its start (`ReducedMotion.endOf`): the starts as given then.
  const end = Bool.match(ReducedMotion.endOf(false, true, options), { onTrue: () => to, onFalse: () => Rec.map(pairs, (pair) => pair.from) })
  return (dt) => {
    const frame = progress(dt)
    if (frame.done) return { value: end, done: true }
    return { value: Rec.map(fromPx, (start, key) => start + (UndefinedOr.getOrThrow(toPx[key]) - start) * frame.value), done: false }
  }
}

/** No numbers: a spring whose transition gives every key its velocity (#464). */
const NO_NUMBERS: Record<string, number> = {}

/** No values: the failed leg of Keyframes on a spring draws none (#429). */
const NO_VALUES: Values.Values = {}

/** Whether `key` has Keyframes of more than two stops in `stops` (#429): none without any. */
const hasStops = (stops: StopsByKey | undefined, key: string): boolean => {
  if (Predicate.isUndefined(stops)) return false
  return Object.hasOwn(stops, key)
}

/** Whether any key of `values` has Keyframes of more than two stops (#429): per Retarget, so nothing made. */
const anyKeyframed = (values: Values.Values, stops: StopsByKey | undefined): boolean => {
  if (Predicate.isUndefined(stops)) return false
  return Rec.some(values, (_, key) => Object.hasOwn(stops, key))
}

/** Each key's stops (#429): its Keyframes', or its start and target. */
const stopsFor = (from: Values.Values, to: Values.Values, stops: StopsByKey | undefined): StopsByKey =>
  Rec.map(to, (target, key): ReadonlyArray<number | string> => {
    if (hasStops(stops, key)) return (stops as StopsByKey)[key] as ReadonlyArray<number | string>
    return [UndefinedOr.getOrThrow(from[key]), target]
  })

/**
 * {@link legsOf} on one transition: as it runs, or, when it defines none, each key on its Default
 * transition (ADR-0051), the keys that share one on one leg's worth.
 */
const legsOn = (
  from: Values.Values,
  to: Values.Values,
  given: WardicTransition | undefined,
  reducedMotion: boolean,
  skipped: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  defaults: DefaultTransition.DefaultTransition["Service"],
  velocities: Velocities,
  follow: Follows | undefined,
  stops: StopsByKey | undefined,
  measured: MeasuredPairs | undefined,
): ReadonlyArray<Leg> => {
  const run = runOf(given)
  if (Predicate.isNotUndefined(run)) {
    if (run.type === "inertia") return inertiaLegsOn(from, to, run as Run & InertiaRun, given, reducedMotion, skipped, positionalKeys, defaults, velocities, follow, stops, measured)
    return legsWith(from, to, run, reducedMotion, skipped, positionalKeys, velocities, follow, stops, measured)
  }
  const keys = Rec.keys(to)
  if (keys.length === 0) return NO_LEGS
  // Nearly always one Default transition for every key (a fade, a move): no grouping.
  const first = defaultFor(defaults, UndefinedOr.getOrThrow(keys[0]), to, stops)
  if (Arr.every(keys, (key) => defaultFor(defaults, key, to, stops) === first)) {
    return legsWith(from, to, carried(first, given), reducedMotion, skipped, positionalKeys, velocities, follow, stops, measured)
  }
  const byDefault = new Map<DefaultTransition.Transition | DefaultTransition.KeyframesTransition, Record<string, number | string>>()
  Arr.forEach(keys, (key) => {
    const runsOn = defaultFor(defaults, key, to, stops)
    const grouped = byDefault.get(runsOn)
    if (Predicate.isNotUndefined(grouped)) {
      grouped[key] = to[key] as number | string
      return
    }
    byDefault.set(runsOn, { [key]: to[key] as number | string })
  })
  return Arr.flatMap(Arr.fromIterable(byDefault), ([runsOn, grouped]) => legsWith(from, grouped, carried(runsOn, given), reducedMotion, skipped, positionalKeys, velocities, follow, stops, measured))
}

/**
 * The Default transition `key` runs on (ADR-0051): its Environment's for it, toward its target, or,
 * through Keyframes of more than two stops, its Environment's keyframes one (#429, Motion's).
 */
const defaultFor = (
  defaults: DefaultTransition.DefaultTransition["Service"],
  key: string,
  to: Values.Values,
  stops: StopsByKey | undefined,
): DefaultTransition.Transition | DefaultTransition.KeyframesTransition => {
  if (hasStops(stops, key)) return defaults.keyframes
  return defaults.transitionFor(key, to[key] as number | string)
}

/**
 * A Default transition with what the transition that defines none still says: its `delay` (a
 * stagger's among it, ADR-0007), its reduced-motion opt-out and its `skipAnimations` (#468). The
 * Default transition itself when it says none, as nearly every element's (it has no transition).
 */
const carried = (runsOn: DefaultTransition.Transition | DefaultTransition.KeyframesTransition, given: WardicTransition | undefined): Run => {
  if (Predicate.isUndefined(given)) return runsOn
  const { delay, respectReducedMotion, skipAnimations } = given
  // Per Retarget (#460): statements.
  if (Predicate.isUndefined(delay) && Predicate.isUndefined(respectReducedMotion) && Predicate.isUndefined(skipAnimations)) return runsOn
  return { ...runsOn, ...Rec.filter({ delay, respectReducedMotion, skipAnimations }, Predicate.isNotUndefined) } as Run
}

/** The keys reduced motion snaps (ADR-0029), when it applies; else none, every key animating. */
const reducedSplitOf = (to: Values.Values, applies: boolean, positionalKeys: ReducedMotion.PositionalKeys["Service"]): ReducedMotion.Split => {
  if (applies) return ReducedMotion.split(to, positionalKeys)
  return { positional: {}, rest: to }
}

/** {@link legsOf} on one transition as it runs. */
const legsWith = (
  from: Values.Values,
  to: Values.Values,
  transition: Run,
  reducedMotion: boolean,
  skipped: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  velocities: Velocities,
  follow: Follows | undefined,
  stops: StopsByKey | undefined,
  measured: MeasuredPairs | undefined,
): ReadonlyArray<Leg> => {
  // A **Skipped animation** (#468, Motion's `skipAnimations`): every key lands where its leg would end,
  // on its first tick, with no delay and whatever reduced motion says. Keyframes land on their last
  // stop, a turned `repeat` where it ends, a Measured pair on its target as given, and a return to a
  // moving Live value on where it is now, its follower taking over once it lands.
  // Per Retarget (#460, compose once): statements.
  if (skipped || transition.skipAnimations === true) return [snapLeg(from, to, Rec.map(to, (target, key) => endOfLeg(from, target, key, transition, velocities)), NO_DELAY)]
  // An inertia's numbers (#435): its other keys went to their Default transitions ({@link inertiaLegsOn}).
  if (transition.type === "inertia") return inertiaLegsWith(from, to, transition as InertiaRun, reducedMotion, positionalKeys, velocities, stops)
  const useTween = transition.type === "tween"
  // Reduced motion (ADR-0029): the positional keys snap to where their leg would end, holding
  // through the delay it would hold, and the rest animate as they would. A transition opts out with
  // `respectReducedMotion: false`.
  const respects = transition.respectReducedMotion !== false
  const { positional, rest } = reducedSplitOf(to, respects && reducedMotion, positionalKeys)
  const snapping = hasKeys(positional)
  let followingKeys = NO_KEYS
  if (Predicate.isNotUndefined(follow)) followingKeys = follow.keysOf(rest)
  const following = followingKeys.length > 0
  let fixed = rest
  if (following) fixed = Rec.filter(rest, (_, key) => !Arr.contains(followingKeys, key))
  // Built a leg at a time, once a Retarget (#69's PR 2: a Retarget is per element, so no spreads).
  const legs: Array<Leg> = []
  // Measured pairs (#430): a leg of their own, between their ends in px, on this transition.
  const measuring = anyMeasured(fixed, measured)
  if (measuring) {
    const kept = fixed
    const pairs = Rec.filter(measured as MeasuredPairs, (_, key) => Object.hasOwn(kept, key))
    legs.push(measuredLegOf(pairs, transition))
    fixed = Rec.filter(kept, (_, key) => !Object.hasOwn(pairs, key))
  }
  if (useTween) {
    // Its options as they are: a missing `duration` is core's 0.3 s, and the rest still apply (#107).
    const options = transition as Machine.KeyframesOptions
    // A tween's snap lands where the tween would end: `repeat` and `reverse` can end it at `from`, a
    // Keyframes key's first stop (#429). Its delay alone is read: an `ease` per Interval isn't a tween's.
    if (snapping) {
      legs.push(snapLeg(from, positional, Rec.map(positional, (to, key) => ReducedMotion.endOf(UndefinedOr.getOrThrow(from[key]), to, options)), () => Machine.resolveTween(Rec.filter({ delay: options.delay }, Predicate.isNotUndefined)).delay))
    }
    // A following return eases toward where its Live value is each frame, so it lands on it.
    if (following) Arr.forEach(followingKeys, (key) => {
      const start = from[key] as number
      const target = UndefinedOr.getOrThrow(follow).targetOf(key, start)
      legs.push({
        _tag: "Follow",
        key,
        to: { [key]: UndefinedOr.getOrThrow(rest[key]) },
        machine: () =>
          Machine.map(Machine.animate(0, 1, options as Machine.AnimateOptions), (progress) => ({
            value: start + (target() - start) * progress.value,
            done: progress.done,
          })),
      })
    })
    // With every key snapped, following or measured, there's nothing left to tween.
    if ((!snapping && !following && !measuring) || hasKeys(fixed)) {
      // A key's Keyframes, or `times` or an `ease` per Interval, run every key through `keyframesValues`
      // (#429), on one run, a target as its two stops.
      if (anyKeyframed(fixed, stops) || keyframedOptions(options)) {
        legs.push({ _tag: "Blend", to: fixed, machine: () => Machine.keyframesValues(stopsFor(from, fixed, stops), options) })
        return legs
      }
      legs.push({ _tag: "Blend", to: fixed, machine: () => Machine.animateValues(Values.pick(from, fixed), fixed, options as Machine.AnimateOptions) })
    }
    return legs
  }
  // Spring (default): numeric keys via springValues (velocity-carrying Retarget); any string/colour
  // keys via springBlend, the same spring on a 0→100 progress (ADR-0024, D5).
  const springOpts = transition as Machine.SpringOptions
  // Keyframes of more than two stops on a spring (#429): Motion's error, a leg that fails as it's
  // built, and each such key snapped to its last stop.
  if (anyKeyframed(fixed, stops)) {
    const kept = fixed
    const many = Rec.filter(stops as StopsByKey, (_, key) => Object.hasOwn(kept, key))
    const ends = Rec.filter(kept, (_, key) => Object.hasOwn(many, key))
    legs.push(snapLeg(from, ends, ends, () => Spring.resolve(springOpts).delay))
    legs.push({ _tag: "Blend", to: NO_VALUES, machine: () => Effect.die(springStopsError(many)) })
    fixed = Rec.filter(kept, (_, key) => !Object.hasOwn(many, key))
  }
  const { numbers: numeric, strings } = Values.split(fixed)
  // A spring settles at its target: the snap lands there.
  if (snapping) legs.push(snapLeg(from, positional, positional, () => Spring.resolve(springOpts).delay))
  // A following return chases its Live value, read each step, and settles at rest on it.
  if (following) Arr.forEach(followingKeys, (key) => {
    const start = from[key] as number
    let velocity = springOpts.velocity
    if (Predicate.isUndefined(velocity)) velocity = velocities(key)
    const chase = Machine.chase(UndefinedOr.getOrThrow(follow).targetOf(key, start), { ...springOpts, from: start, velocity })
    legs.push({ _tag: "Follow", key, to: { [key]: UndefinedOr.getOrThrow(rest[key]) }, machine: () => settling(chase) })
  })
  if (hasKeys(numeric)) {
    const fromNumeric: Record<string, number> = Rec.map(numeric, (_, key) => from[key] as number)
    // Each key's own velocity, read now; none when the transition gives one, which every key then starts with.
    let fromVelocity: Record<string, number> = NO_NUMBERS
    if (Predicate.isUndefined(springOpts.velocity)) fromVelocity = Rec.map(numeric, (_, key) => velocities(key))
    legs.push({ _tag: "Numbers", to: numeric, machine: () => Machine.springValues(numeric, springOpts, { from: fromNumeric, velocity: fromVelocity }) })
  }
  if (hasKeys(strings)) {
    const fromStrings: Values.Values = Rec.map(strings, (_, key) => UndefinedOr.getOrThrow(from[key]))
    legs.push({ _tag: "Blend", to: strings, machine: () => Machine.springBlend(fromStrings, strings, springOpts) })
  }
  return legs
}

/** What a leg's machine can be run through: the same Frames, stepped another way. */
export type MachineMap = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>) => Machine.Machine<F>

/**
 * `leg` with its machine run through `f`: started partway ({@link startingAt}), or through an
 * **Imperative animation**'s Playhead (#433, `Playback.drive`).
 */
export const mapMachine = (leg: Leg, f: MachineMap): Leg => mapMachineMatch({ leg, f })

/** {@link mapMachine}'s cases, built once at module load: it runs per element at hydration (#69's PR 2). */
const mapMachineMatch: (input: { readonly leg: Leg; readonly f: MachineMap }) => Leg = Match.type<{ readonly leg: Leg; readonly f: MachineMap }>().pipe(
  Match.when({ leg: { _tag: "Blend" } }, ({ leg, f }): Leg => ({ ...leg, machine: () => Effect.map(leg.machine(), f) })),
  Match.orElse(({ leg, f }): Leg => {
    const plain = leg as Exclude<Leg, Blend>
    return { ...plain, machine: () => f(plain.machine() as Machine.Machine<Frame.Frame<unknown>>) } as Leg
  }),
)

/**
 * `leg`, started `at()` seconds in (`Machine.startAt`): a Handoff's first legs, which pick up an
 * Appear animation where its CSS has got (#48, ADR-0044 decision 6).
 */
export const startingAt = (leg: Leg, at: LazyArg<number>): Leg => mapMachine(leg, Machine.startAt(at))

/**
 * Where `key`'s leg would end (#468): an inertia's where its glide rests (#435, `Inertia.restOf`), from
 * its velocity, whatever its target; any other's at its target, or where a turned `repeat` ends.
 */
const endOfLeg = (from: Values.Values, target: number | string, key: string, transition: Run, velocities: Velocities): number | string => {
  const start = UndefinedOr.getOrThrow(from[key])
  if (transition.type !== "inertia") return ReducedMotion.endOf(start, target, transition as Machine.Modifiers)
  return Inertia.restOf(start as number, inertiaVelocityOf(transition as InertiaRun, velocities, key), transition as InertiaRun)
}

/** A key's velocity under an inertia (#435): the transition's `velocity`, else its own (#464). */
const inertiaVelocityOf = (run: InertiaRun, velocities: Velocities, key: string): number =>
  UndefinedOr.match(run.velocity, { onUndefined: () => velocities(key), onDefined: identity })

/**
 * {@link legsOf} on an inertia (#435, Q2): the numbers glide on it ({@link inertiaLegsWith}); every
 * other key, and a return following a moving Live value, runs on its Default transition, as if the
 * transition defined none for it, its `delay`, reduced-motion opt-out and `skipAnimations` kept.
 */
const inertiaLegsOn = (
  from: Values.Values,
  to: Values.Values,
  run: Run & InertiaRun,
  given: WardicTransition | undefined,
  reducedMotion: boolean,
  skipped: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  defaults: DefaultTransition.DefaultTransition["Service"],
  velocities: Velocities,
  follow: Follows | undefined,
  stops: StopsByKey | undefined,
  measured: MeasuredPairs | undefined,
): ReadonlyArray<Leg> => {
  let followingKeys = NO_KEYS
  if (Predicate.isNotUndefined(follow)) followingKeys = follow.keysOf(to)
  const glides = (target: number | string, key: string): boolean =>
    Bool.and(Bool.and(Predicate.isNumber(target), Predicate.isNumber(from[key])), Bool.not(Arr.contains(followingKeys, key)))
  const numbers = Rec.filter(to, glides)
  const rest = Rec.filter(to, (target, key) => Bool.not(glides(target, key)))
  const legs: Array<Leg> = []
  if (hasKeys(numbers)) Arr.forEach(legsWith(from, numbers, run, reducedMotion, skipped, positionalKeys, velocities, undefined, stops, undefined), (leg) => legs.push(leg))
  if (hasKeys(rest)) Arr.forEach(legsOn(from, rest, definingNone(given), reducedMotion, skipped, positionalKeys, defaults, velocities, follow, stops, measured), (leg) => legs.push(leg))
  return legs
}

/** A transition's fields that define none: its `delay`, reduced-motion opt-out and `skipAnimations`, on a Default transition. */
const definingNone = (given: WardicTransition | undefined): WardicTransition | undefined =>
  UndefinedOr.map(given, ({ delay, respectReducedMotion, skipAnimations }) => Rec.filter({ delay, respectReducedMotion, skipAnimations }, Predicate.isNotUndefined) as WardicTransition)

/**
 * An inertia's legs over numbers (#435): each glides from where it is at its velocity, on
 * `Machine.inertiaValues`, whatever its target. Under reduced motion its positional keys land where
 * their glides rest, after its delay (ADR-0029); Keyframes of more than two stops fail, as a spring's
 * (#429, Motion's two-keyframe invariant), each such key landing on its last stop.
 */
const inertiaLegsWith = (
  from: Values.Values,
  to: Values.Values,
  run: InertiaRun,
  reducedMotion: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  velocities: Velocities,
  stops: StopsByKey | undefined,
): ReadonlyArray<Leg> => {
  const legs: Array<Leg> = []
  const delay = (): number => UndefinedOr.match(run.delay, { onUndefined: () => 0, onDefined: identity })
  let fixed = to
  if (anyKeyframed(fixed, stops)) {
    const kept = fixed
    const many = Rec.filter(stops as StopsByKey, (_, key) => Object.hasOwn(kept, key))
    const ends = Rec.filter(kept, (_, key) => Object.hasOwn(many, key))
    legs.push(snapLeg(from, ends, ends, delay))
    legs.push({ _tag: "Blend", to: NO_VALUES, machine: () => Effect.die(springStopsError(many, "an inertia")) })
    fixed = Rec.filter(kept, (_, key) => !Object.hasOwn(many, key))
  }
  if (Bool.and(reducedMotion, (run as Run).respectReducedMotion !== false)) {
    const { positional, rest } = ReducedMotion.split(fixed, positionalKeys)
    if (hasKeys(positional)) {
      legs.push(snapLeg(from, positional, Rec.map(positional, (_, key) => Inertia.restOf(from[key] as number, inertiaVelocityOf(run, velocities, key), run)), delay))
    }
    fixed = rest
  }
  if (hasKeys(fixed)) {
    const starts: Record<string, number> = Rec.map(fixed, (_, key) => from[key] as number)
    // Each key's own velocity, read now (#464); none when the transition gives one, which every key then starts with.
    const own: Record<string, number> = Bool.match(Predicate.isUndefined(run.velocity), {
      onTrue: () => Rec.map(fixed, (_, key) => velocities(key)),
      onFalse: () => NO_NUMBERS,
    })
    legs.push({ _tag: "Numbers", to: fixed, machine: () => Machine.inertiaValues(starts, run, { velocity: own }) })
  }
  return legs
}

/** No delay: a Skipped animation's snap (#468). */
const NO_DELAY = (): number => 0

/** The snap's leg: the positional keys, from where they are to `to`, after `delay()`. */
const snapLeg = (from: Values.Values, positional: Values.Values, to: Values.Values, delay: () => number): Snap => ({
  _tag: "Snap",
  keys: Rec.keys(positional),
  to: positional,
  machine: () => ReducedMotion.snap(Values.pick(from, positional), to, { delay: delay() }),
})

/** `chase`, ending at its first Frame at rest on its target: a return to a moving Live value (#130). */
const settling = <F extends Frame.Frame<unknown>>(chase: Machine.Machine<F>): Machine.Machine<F> =>
  Machine.make({ start: chase.start, settles: true, span: chase.span })
