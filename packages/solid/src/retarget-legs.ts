/**
 * A Retarget's legs as one pure builder (#48, ADR-0044 decision 8): which machines a Retarget
 * runs, each from where and on which transition, with nothing of the element's (its gate, its
 * Snapshot, its fibers). The spine runs each leg into its sinks; a server render samples a mount's
 * legs into an Appear animation's rule, so the two can't drift.
 *
 * - **Which transition** (ADR-0051, #357): a key runs on the transition it resolves to (#301), as
 *   Motion's: with none defined there, on its Environment's Default transition for it ({@link runOf}).
 * - **A tween** runs every key, numbers and strings, in one `animateValues` leg.
 * - **A spring** runs the numbers in one `springValues` leg, carrying velocity, and the strings in
 *   one `springBlend` leg on the same spring (ADR-0024, D5).
 * - **Reduced motion** (ADR-0029): when it applies, the positional keys snap in a leg of their own,
 *   after the delay their transition gives, to where their leg would have ended.
 * - **A return to a moving Live value** (#130, ADR-0043 decision 6) runs a leg of its own per key,
 *   a tween easing toward it, a spring chasing it.
 *
 * The legs come in the order the spine starts them: the snap, the follows, then the rest. A leg's
 * machine is built when it's called, inside the leg's own fiber, so a transition core rejects
 * fails that leg alone (#66).
 */
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Spring from "@wardic/core/Spring"
import * as Values from "@wardic/core/Values"
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

/** The orchestration's fields (ADR-0007): read by the variant tree, never by a machine. */
const ORCHESTRATION = ["staggerChildren", "delayChildren", "from", "staggerDirection", "when"] as const

/** A transition as a machine takes it: without the orchestration's fields (#243), each arm. */
export type MotionTransition = WardicTransition extends infer T ? (T extends unknown ? Omit<T, (typeof ORCHESTRATION)[number]> : never) : never

/** Each transition without its orchestration, by the transition: one object each, so core's decode cache hits (#66). */
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

/** An entry as its key runs on it (#301): over the own fields with `inherit`, else with their reduced-motion opt-out alone. */
const resolvedEntry = (own: WardicTransition, entry: WardicTransition): WardicTransition => {
  const { inherit, ...rest } = entry as WardicTransition & { readonly inherit?: boolean }
  if (inherit === true) return { ...own, ...rest } as WardicTransition
  if (Bool.or(Predicate.isUndefined(own.respectReducedMotion), Predicate.isNotUndefined(rest.respectReducedMotion))) return rest as WardicTransition
  return { ...rest, respectReducedMotion: own.respectReducedMotion } as WardicTransition
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
export type Run = DefaultTransition.Transition & { readonly respectReducedMotion?: boolean }

/**
 * The spring fields: one of them, with no `type`, makes a transition a spring, a value's or a layout
 * animation's (ADR-0009 *Amendment (#171)*, ADR-0051).
 */
export const SPRING_FIELDS = ["stiffness", "damping", "mass", "velocity", "restDelta", "restSpeed"] as const

/**
 * The fields that don't define a transition, beside the orchestration's ({@link motionOf}): Motion's
 * `isTransitionDefined` (at 16c6122) skips `delay`; Wardic's reduced-motion opt-out and a target's
 * `inherit` aren't a transition's either. `repeat` and its fields do define one, a tween (ADR-0051).
 */
const NOT_DEFINING: ReadonlySet<string> = new Set(["delay", "respectReducedMotion", "inherit"])

/** Motion's spring defaults (`springDefaults`): what a spring transition leaves out (ADR-0051). */
const MOTION_SPRING = { stiffness: 100, damping: 10, mass: 1 } as const


/** A transition that defines nothing: its keys run on their Default transitions. */
const NOT_DEFINED: unique symbol = Symbol("wardic.notDefined")

/** Each transition as its legs run it, by the transition: one object each, so core's decode cache hits (#66). */
const RUNS = new WeakMap<object, Run | typeof NOT_DEFINED>()

/** A field a transition gives: set, and not an entry (#301). */
const isGiven = (value: unknown): boolean => Bool.and(Predicate.isNotUndefined(value), Bool.not(isEntry(value)))

/** Whether a field defines a transition. */
const isDefining = (key: string): boolean => Bool.not(NOT_DEFINING.has(key))

/** Whether a transition's fields make it a spring: `type: "spring"`, or no `type` and a spring field. */
const isSpring = (fields: Readonly<Record<string, unknown>>): boolean =>
  Bool.or(fields.type === "spring", Bool.and(Predicate.isUndefined(fields.type), Arr.some(SPRING_FIELDS, (key) => Object.hasOwn(fields, key))))

/** {@link runOf}'s work, once a transition: its given fields, and what they make. */
const madeRun = (given: WardicTransition): Run | typeof NOT_DEFINED => {
  const fields = Rec.filter(UndefinedOr.getOrThrow(motionOf(given)) as Readonly<Record<string, unknown>>, isGiven)
  if (Bool.not(Arr.some(Rec.keys(fields), isDefining))) return NOT_DEFINED
  return Bool.match(isSpring(fields), {
    onTrue: (): Run => ({ ...MOTION_SPRING, ...fields, type: "spring" }) as Run,
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
 *   (a tween's 0.3 s is core's too).
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
 * @param positionalKeys which keys are positional: the Environment's (ADR-0036)
 * @param defaults what a key with no transition defined runs on: the Environment's (ADR-0051)
 * @param velocities each key's velocity now: a spring starts from it
 * @param follow the returns that follow a moving Live value (#130), given only when the Retarget returns a key
 */
export const legsOf = (
  from: Values.Values,
  to: Values.Values,
  given: WardicTransition | undefined,
  reducedMotion: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  defaults: DefaultTransition.DefaultTransition["Service"],
  velocities: Readonly<Record<string, number>>,
  follow?: Follows | undefined,
): ReadonlyArray<Leg> => {
  // Each key on its own transition (#301): with entries, the keys go by the transition each runs on.
  const entries = entriesOf(given)
  if (Predicate.isUndefined(entries)) return legsOn(from, to, given, reducedMotion, positionalKeys, defaults, velocities, follow)
  // With no value's entry (`layout` and `default` alone), every key runs on one transition.
  if (Bool.not(entries.byValue)) return legsOn(from, to, forKey(entries, "default"), reducedMotion, positionalKeys, defaults, velocities, follow)
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
  return Arr.flatMap(Arr.fromIterable(byTransition), ([runsOn, keys]) => legsOn(from, keys, runsOn, reducedMotion, positionalKeys, defaults, velocities, follow))
}

/** No legs: a Retarget with no key. */
const NO_LEGS: ReadonlyArray<Leg> = []

/**
 * {@link legsOf} on one transition: as it runs, or, when it defines none, each key on its Default
 * transition (ADR-0051), the keys that share one on one leg's worth.
 */
const legsOn = (
  from: Values.Values,
  to: Values.Values,
  given: WardicTransition | undefined,
  reducedMotion: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  defaults: DefaultTransition.DefaultTransition["Service"],
  velocities: Readonly<Record<string, number>>,
  follow: Follows | undefined,
): ReadonlyArray<Leg> => {
  const run = runOf(given)
  if (Predicate.isNotUndefined(run)) return legsWith(from, to, run, reducedMotion, positionalKeys, velocities, follow)
  const keys = Rec.keys(to)
  if (keys.length === 0) return NO_LEGS
  // Nearly always one Default transition for every key (a fade, a move): no grouping.
  const first = defaults.transitionFor(UndefinedOr.getOrThrow(keys[0]), to[UndefinedOr.getOrThrow(keys[0])] as number | string)
  if (Arr.every(keys, (key) => defaults.transitionFor(key, to[key] as number | string) === first)) {
    return legsWith(from, to, carried(first, given), reducedMotion, positionalKeys, velocities, follow)
  }
  const byDefault = new Map<DefaultTransition.Transition, Record<string, number | string>>()
  Arr.forEach(keys, (key) => {
    const runsOn = defaults.transitionFor(key, to[key] as number | string)
    const grouped = byDefault.get(runsOn)
    if (Predicate.isNotUndefined(grouped)) {
      grouped[key] = to[key] as number | string
      return
    }
    byDefault.set(runsOn, { [key]: to[key] as number | string })
  })
  return Arr.flatMap(Arr.fromIterable(byDefault), ([runsOn, grouped]) => legsWith(from, grouped, carried(runsOn, given), reducedMotion, positionalKeys, velocities, follow))
}

/**
 * A Default transition with what the transition that defines none still says: its `delay` (a
 * stagger's among it, ADR-0007) and its reduced-motion opt-out. The Default transition itself when
 * it says neither, as nearly every element's (it has no transition).
 */
const carried = (runsOn: DefaultTransition.Transition, given: WardicTransition | undefined): Run => {
  if (Predicate.isUndefined(given)) return runsOn
  const { delay, respectReducedMotion } = given
  if (Bool.and(Predicate.isUndefined(delay), Predicate.isUndefined(respectReducedMotion))) return runsOn
  return { ...runsOn, ...Rec.filter({ delay, respectReducedMotion }, Predicate.isNotUndefined) } as Run
}

/** {@link legsOf} on one transition as it runs. */
const legsWith = (
  from: Values.Values,
  to: Values.Values,
  transition: Run,
  reducedMotion: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  velocities: Readonly<Record<string, number>>,
  follow: Follows | undefined,
): ReadonlyArray<Leg> => {
  const useTween = transition.type === "tween"
  // Reduced motion (ADR-0029): the positional keys snap to where their leg would end, holding
  // through the delay it would hold, and the rest animate as they would. A transition opts out with
  // `respectReducedMotion: false`.
  const respects = transition.respectReducedMotion !== false
  const { positional, rest } = Bool.match(Bool.and(respects, reducedMotion), {
    onTrue: () => ReducedMotion.split(to, positionalKeys),
    onFalse: (): ReducedMotion.Split => ({ positional: {}, rest: to }),
  })
  const snapping = hasKeys(positional)
  let followingKeys = NO_KEYS
  if (Predicate.isNotUndefined(follow)) followingKeys = follow.keysOf(rest)
  const following = followingKeys.length > 0
  let fixed = rest
  if (following) fixed = Rec.filter(rest, (_, key) => Bool.not(Arr.contains(followingKeys, key)))
  // Built a leg at a time, once a Retarget (#69's PR 2: a Retarget is per element, so no spreads).
  const legs: Array<Leg> = []
  if (useTween) {
    // Its options as they are: a missing `duration` is core's 0.3 s, and the rest still apply (#107).
    const options = transition as Machine.AnimateOptions
    // A tween's snap lands where the tween would end: `repeat` and `reverse` can end it at `from`.
    if (snapping) {
      legs.push(snapLeg(from, positional, Rec.map(positional, (to, key) => ReducedMotion.endOf(UndefinedOr.getOrThrow(from[key]), to, options)), () => Machine.resolveTween(options).delay))
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
          Machine.animate(0, 1, options).pipe(
            Machine.map((progress) => ({ value: start + (target() - start) * progress.value, done: progress.done })),
          ),
      })
    })
    // With every key snapped or following, there's nothing left to tween.
    if (Bool.or(Bool.and(!snapping, !following), hasKeys(fixed))) {
      legs.push({ _tag: "Blend", to: fixed, machine: () => Machine.animateValues(Values.pick(from, fixed), fixed, options) })
    }
    return legs
  }
  // Spring (default): numeric keys via springValues (velocity-carrying Retarget); any string/colour
  // keys via springBlend, the same spring on a 0→100 progress (ADR-0024, D5).
  const springOpts = transition as Machine.SpringOptions
  const { numbers: numeric, strings } = Values.split(fixed)
  // A spring settles at its target: the snap lands there.
  if (snapping) legs.push(snapLeg(from, positional, positional, () => Spring.resolve(springOpts).delay))
  // A following return chases its Live value, read each step, and settles at rest on it.
  if (following) Arr.forEach(followingKeys, (key) => {
    const start = from[key] as number
    const velocity = UndefinedOr.match(velocities[key], { onUndefined: () => 0, onDefined: identity })
    const chase = Machine.chase(UndefinedOr.getOrThrow(follow).targetOf(key, start), { ...springOpts, from: start, velocity })
    legs.push({ _tag: "Follow", key, to: { [key]: UndefinedOr.getOrThrow(rest[key]) }, machine: () => settling(chase) })
  })
  if (hasKeys(numeric)) {
    const fromNumeric: Record<string, number> = Rec.map(numeric, (_, key) => from[key] as number)
    legs.push({ _tag: "Numbers", to: numeric, machine: () => Machine.springValues(numeric, springOpts, fromNumeric, velocities) })
  }
  if (hasKeys(strings)) {
    const fromStrings: Values.Values = Rec.map(strings, (_, key) => UndefinedOr.getOrThrow(from[key]))
    legs.push({ _tag: "Blend", to: strings, machine: () => Machine.springBlend(fromStrings, strings, springOpts) })
  }
  return legs
}

/**
 * `leg`, started `at()` seconds in (`Machine.startAt`): a Handoff's first legs, which pick up an
 * Appear animation where its CSS has got (#48, ADR-0044 decision 6).
 */
export const startingAt = (leg: Leg, at: LazyArg<number>): Leg => startingAtMatch({ leg, at })

/** {@link startingAt}'s cases, built once at module load: it runs per element at hydration (#69's PR 2). */
const startingAtMatch: (input: { readonly leg: Leg; readonly at: LazyArg<number> }) => Leg = Match.type<{ readonly leg: Leg; readonly at: LazyArg<number> }>().pipe(
  Match.when({ leg: { _tag: "Blend" } }, ({ leg, at }): Leg => ({ ...leg, machine: () => Effect.map(leg.machine(), Machine.startAt(at)) })),
  Match.orElse(({ leg, at }): Leg => {
    const plain = leg as Exclude<Leg, Blend>
    return { ...plain, machine: () => (plain.machine() as Machine.Machine<Frame.Frame<unknown>>).pipe(Machine.startAt(at)) } as Leg
  }),
)

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
