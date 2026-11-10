/**
 * Keyframes' and `animate`'s bags resolved (#429): the repeat modifiers, a run of repeats, and a
 * keyframes bag's easings and times, checked once a bag. `Machine`'s `animate`, `keyframes` and
 * `keyframesValues` read them, and a Batch's keyframes (#665), which step each member's key by hand.
 * Not importable from outside core (`package.json`'s `"./internal/*": null`).
 */
// Moved out of Machine.ts for the Batch (#665, Q36): Machine imports them back.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Easing from "../Easing.ts"
import type { KeyframesOptions } from "../Machine.ts"
import { array, boolean, cachedResolver, field, finite, literals, nonEmptyArray, nonNegative, number, optionalField, refine, union } from "./options.ts"
import { EaseDefinition, type ResolvedRun, type ResolvedTween, resolvedTweenOf, TweenFields } from "./stepper.ts"

const NOT_REPEAT = "Expected a whole number of repeats, 0 or above, or Infinity"

/** A repeat count: a whole number, 0 or above, or `Infinity` to loop forever. */
const Repeat = refine(number, (n) => n === Infinity || (Number.isInteger(n) && n >= 0) || NOT_REPEAT)

/** The {@link Modifiers}, resolved: as given, defaults filled in. */
export interface ResolvedModifiers {
  readonly repeat: number
  readonly repeatDelay: number
  readonly repeatType: "loop" | "reverse" | "mirror"
  readonly reverse: boolean
}

/** The {@link Modifiers}' fields (#66): `animate`'s bag and `keyframes`' (#429) add them to a tween's. */
export const ModifierFields = {
  repeat: field(Repeat, 0),
  repeatDelay: field(nonNegative, 0),
  repeatType: field(literals(["loop", "reverse", "mirror"]), "loop"),
  reverse: field(boolean, false),
}

/** A decoded bag's run: its tween played `repeat + 1` times, with its tween's `delay` 0 (held outside, by `delay`). */
export const resolvedRunOf = (tween: ResolvedTween, modifiers: ResolvedModifiers): ResolvedRun => {
  const cycle = tween.duration + modifiers.repeatDelay
  return {
    tween: { ...tween, delay: 0 },
    repeats: modifiers.repeat,
    gap: modifiers.repeatDelay,
    cycle,
    total: cycle * (modifiers.repeat + 1) - modifiers.repeatDelay,
    reverses: modifiers.repeatType === "reverse",
    mirrors: modifiers.repeatType === "mirror",
  }
}

/** `keyframes`' bag resolved (#429): its run (its tween's `delay` 0), an easing per Interval, and each stop's place in time. */
export interface ResolvedKeyframes extends ResolvedModifiers {
  readonly run: ResolvedRun
  readonly delay: number
  readonly seconds: number
  readonly eases: Arr.NonEmptyReadonlyArray<Easing.Easing>
  readonly times: ReadonlyArray<number> | undefined
}

/** One `ease` or several (#360): a list is an array whose first item isn't a number, which a bézier's is. */
const EaseOrList = union([EaseDefinition, nonEmptyArray(EaseDefinition)])

/** Whether `times` run from 0 to 1, none before the one ahead of it. */
const inOrder = (times: ReadonlyArray<number>): boolean => {
  // The pairs only once every time is in range (#460, Q8).
  if (!Arr.every(times, (time) => Bool.and(time >= 0, time <= 1))) return false
  return Arr.every(Arr.zip(times, Arr.drop(times, 1)), ([before, after]) => after >= before)
}

const NOT_IN_ORDER = "Expected times from 0 to 1, in order"

/** Each stop's place in time (#429): numbers from 0 to 1, in order. */
const Times = refine(array(finite), (times) => inOrder(times) || NOT_IN_ORDER)

/**
 * `keyframes`' bag (#66): a tween's fields, its `ease` one Definition or one per Interval (#360), its
 * `times` and the repeat modifiers (#429), checked once a bag.
 */
export const resolveKeyframes: (options: KeyframesOptions) => ResolvedKeyframes = cachedResolver(
  { ...TweenFields, ...ModifierFields, ease: field(EaseOrList, Easing.linear), times: optionalField(Times) },
  (decoded): ResolvedKeyframes => {
    const list: Arr.NonEmptyReadonlyArray<Easing.Definition> = Bool.match(Bool.and(Arr.isArray(decoded.ease), Bool.not(Easing.isBezier(decoded.ease))), {
      onTrue: () => decoded.ease as Arr.NonEmptyReadonlyArray<Easing.Definition>,
      onFalse: (): Arr.NonEmptyReadonlyArray<Easing.Definition> => [decoded.ease as Easing.Definition],
    })
    const tween = resolvedTweenOf({ ...decoded, ease: list[0] })
    return {
      run: resolvedRunOf(tween, decoded),
      delay: tween.delay,
      seconds: tween.seconds,
      eases: Arr.map(list, Easing.resolve),
      times: decoded.times,
      repeat: decoded.repeat,
      repeatDelay: decoded.repeatDelay,
      repeatType: decoded.repeatType,
      reverse: decoded.reverse,
    }
  },
)
