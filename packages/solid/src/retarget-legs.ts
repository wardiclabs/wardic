/**
 * A Retarget's legs as one pure builder (#48, ADR-0044 decision 8): which machines a Retarget
 * runs, each from where and on which transition, with nothing of the element's (its gate, its
 * Snapshot, its fibers). The spine runs each leg into its sinks; a server render samples a mount's
 * legs into an Appear animation's rule, so the two can't drift.
 *
 * - **A tween** (`type: "tween"`) runs every key, numbers and strings, in one `animateValues` leg.
 * - **A spring** (the default) runs the numbers in one `springValues` leg, carrying velocity, and the
 *   strings in one `springBlend` leg on the same spring (ADR-0024, D5).
 * - **Reduced motion** (ADR-0029): when it applies, the positional keys snap in a leg of their own,
 *   after the delay their transition gives, to where their leg would have ended.
 * - **A return to a moving Live value** (#130, ADR-0043 decision 6) runs a leg of its own per key,
 *   a tween easing toward it, a spring chasing it.
 *
 * The legs come in the order the spine starts them: the snap, the follows, then the rest. A leg's
 * machine is built when it's called, inside the leg's own fiber, so a transition core rejects
 * fails that leg alone (#66).
 */
import type * as Frame from "@wardic/core/Frame"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Spring from "@wardic/core/Spring"
import * as Values from "@wardic/core/Values"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Effect from "effect/Effect"
import { constTrue, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition } from "./create-ward.tsx"

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
  readonly machine: () => Machine.Machine<Frame.Frame<Values.Values>>
}

/** A leg that follows one key's moving Live value (#130). */
export interface Follow {
  readonly _tag: "Follow"
  readonly key: string
  readonly machine: () => Machine.Machine<Frame.Frame<number> & { readonly velocity?: number }>
}

/** A leg over the numeric keys, carrying their velocities: a spring's. */
export interface Numbers {
  readonly _tag: "Numbers"
  readonly machine: () => Machine.Machine<Frame.MultiPhysics>
}

/** A leg over values through the Interpolators: a tween's keys, or a spring's strings. */
export interface Blend {
  readonly _tag: "Blend"
  readonly machine: () => Effect.Effect<Machine.Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry>
}

/** One leg of a Retarget. */
export type Leg = Snap | Follow | Numbers | Blend

/** No transition: a spring with its defaults, one object, so core decodes it once (#66). */
const NO_TRANSITION: Machine.SpringOptions = {}

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
 * @param transition the transition the legs run on, any stagger delay folded in (ADR-0007)
 * @param reducedMotion whether reduced motion is on (the provider's, ADR-0029); a transition can still opt out
 * @param positionalKeys which keys are positional: the Environment's (ADR-0036)
 * @param velocities each key's velocity now: a spring starts from it
 * @param follow the returns that follow a moving Live value (#130), given only when the Retarget returns a key
 */
export const legsOf = (
  from: Values.Values,
  to: Values.Values,
  transition: WardicTransition | undefined,
  reducedMotion: boolean,
  positionalKeys: ReducedMotion.PositionalKeys["Service"],
  velocities: Readonly<Record<string, number>>,
  follow?: Follows | undefined,
): ReadonlyArray<Leg> => {
  const useTween = Predicate.isNotUndefined(transition) && transition.type === "tween"
  // Reduced motion (ADR-0029): the positional keys snap to where their leg would end, holding
  // through the delay it would hold, and the rest animate as they would. A transition opts out with
  // `respectReducedMotion: false`.
  const respects = UndefinedOr.match(transition, { onUndefined: constTrue, onDefined: (tr) => tr.respectReducedMotion !== false })
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
    Arr.forEach(followingKeys, (key) => {
      const start = from[key] as number
      const target = UndefinedOr.getOrThrow(follow).targetOf(key, start)
      legs.push({
        _tag: "Follow",
        key,
        machine: () =>
          Machine.animate(0, 1, options).pipe(
            Machine.map((progress) => ({ value: start + (target() - start) * progress.value, done: progress.done })),
          ),
      })
    })
    // With every key snapped or following, there's nothing left to tween.
    if (Bool.or(Bool.and(!snapping, !following), hasKeys(fixed))) {
      legs.push({ _tag: "Blend", machine: () => Machine.animateValues(Values.pick(from, fixed), fixed, options) })
    }
    return legs
  }
  // Spring (default): numeric keys via springValues (velocity-carrying Retarget); any string/colour
  // keys via springBlend, the same spring on a 0→100 progress (ADR-0024, D5).
  const springOpts = UndefinedOr.match(transition, { onUndefined: () => NO_TRANSITION, onDefined: identity }) as Machine.SpringOptions
  const { numbers: numeric, strings } = Values.split(fixed)
  // A spring settles at its target: the snap lands there.
  if (snapping) legs.push(snapLeg(from, positional, positional, () => Spring.resolve(springOpts).delay))
  // A following return chases its Live value, read each step, and settles at rest on it.
  Arr.forEach(followingKeys, (key) => {
    const start = from[key] as number
    const velocity = UndefinedOr.match(velocities[key], { onUndefined: () => 0, onDefined: identity })
    const chase = Machine.chase(UndefinedOr.getOrThrow(follow).targetOf(key, start), { ...springOpts, from: start, velocity })
    legs.push({ _tag: "Follow", key, machine: () => settling(chase) })
  })
  if (hasKeys(numeric)) {
    const fromNumeric: Record<string, number> = Rec.map(numeric, (_, key) => from[key] as number)
    legs.push({ _tag: "Numbers", machine: () => Machine.springValues(numeric, springOpts, fromNumeric, velocities) })
  }
  if (hasKeys(strings)) {
    const fromStrings: Values.Values = Rec.map(strings, (_, key) => UndefinedOr.getOrThrow(from[key]))
    legs.push({ _tag: "Blend", machine: () => Machine.springBlend(fromStrings, strings, springOpts) })
  }
  return legs
}

/** The snap's leg: the positional keys, from where they are to `to`, after `delay()`. */
const snapLeg = (from: Values.Values, positional: Values.Values, to: Values.Values, delay: () => number): Snap => ({
  _tag: "Snap",
  keys: Rec.keys(positional),
  machine: () => ReducedMotion.snap(Values.pick(from, positional), to, { delay: delay() }),
})

/** `chase`, ending at its first Frame at rest on its target: a return to a moving Live value (#130). */
const settling = <F extends Frame.Frame<unknown>>(chase: Machine.Machine<F>): Machine.Machine<F> =>
  Machine.make({ start: chase.start, settles: true, span: chase.span })
