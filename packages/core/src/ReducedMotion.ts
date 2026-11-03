/**
 * The `ReducedMotion` module: how Wardic honours the user's `prefers-reduced-motion` (ADR-0029).
 *
 * The policy is Motion's (`visual-element-target.ts:146` at 16c6122): under reduced motion, a
 * run's positional keys (the transforms, and the box's position and size) snap to where the run
 * would end, and every other key (opacity, colour, filters) animates as it would. A binding reads
 * its app's {@link Config} and `Probe.prefersReducedMotion` when a run starts ({@link applies}),
 * splits the run's target by its Environment's {@link PositionalKeys} ({@link split}), and runs the
 * positional keys as a {@link snap}. Which keys are positional beyond the transforms is the
 * Environment's (ADR-0036).
 *
 * Tier 2 (ADR-0008), for binding authors.
 */
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as BaseValue from "./BaseValue.ts"
import type * as Frame from "./Frame.ts"
import * as Machine from "./Machine.ts"
import type * as Values from "./Values.ts"

/**
 * An app's reduced-motion setting (Motion's `MotionConfig` `reducedMotion`): `"user"` follows the
 * user's `prefers-reduced-motion`, `"always"` reduces motion whatever it is, and `"never"`
 * animates whatever it is. A binding's default is `"user"`; Motion's is `"never"`.
 */
export type Config = "user" | "always" | "never"

/**
 * Whether reduced motion applies under `config`, given the user's `prefers-reduced-motion`. A binding
 * reads it as each element's animation starts.
 */
export const applies = (config: Config, prefersReducedMotion: boolean): boolean => {
  // Per element at mount (#540): statements.
  if (config === "always") return true
  if (config === "never") return false
  return prefersReducedMotion
}

/** Whether `key` is a transform (`BaseValue.TRANSFORM_IDENTITY`'s keys): Wardic's own, positional in every Environment. */
export const isTransform = (key: string): boolean => Option.isSome(BaseValue.transformIdentity(key))

/**
 * An Environment's **Positional keys** (CONTEXT.md; ADR-0029, ADR-0036): which keys move or resize
 * its elements, which reduced motion Snaps. Core names only the transforms ({@link transformsOnly});
 * an Environment adds its own box keys (the DOM's: `@wardic/dom`'s `PositionalKeysDomLive`). A
 * binding reads it once, as it reads the Probe, and passes it to {@link split}.
 */
export class PositionalKeys extends Context.Service<PositionalKeys, {
  /** Whether reduced motion Snaps `key`. */
  readonly isPositional: (key: string) => boolean
}>()("@wardic/PositionalKeys") {}

/** Positional keys with only the transforms: core's own, and the Test Environment's. */
export const transformsOnly: Layer.Layer<PositionalKeys> = Layer.succeed(PositionalKeys, { isPositional: isTransform })

/** A run's target, split by an Environment's {@link PositionalKeys}. */
export interface Split {
  /** The keys reduced motion snaps. */
  readonly positional: Values.Values
  /** The keys that animate either way. */
  readonly rest: Values.Values
}

/** Split a run's target into the keys reduced motion snaps, by `keys`, and the rest. */
export const split = (values: Values.Values, keys: PositionalKeys["Service"]): Split => ({
  positional: Rec.filter(values, (_, key) => keys.isPositional(key)),
  rest: Rec.filter(values, (_, key) => !keys.isPositional(key)),
})

/** A repeat count whose last run is odd-numbered, which a turning `repeatType` runs backwards: finite, and odd once rounded up. */
const endsBackwards: Predicate.Predicate<number> = Predicate.and(
  (repeats: number) => Number.isFinite(repeats),
  (repeats: number) => Math.ceil(Math.max(0, repeats)) % 2 === 1,
)

/** Whether a `repeatType` turns every other run: `"reverse"` and `"mirror"` do, `"loop"` doesn't. */
const turns = (repeatType: Machine.Modifiers["repeatType"]): boolean => Bool.or(repeatType === "reverse", repeatType === "mirror")

/**
 * Where a `Machine.animate` run from `from` to `to` with `options` ends, which its snap lands on
 * (Motion's `getFinalKeyframe`): `to`, or `from` with `reverse`; with a `repeatType` that turns
 * (`"reverse"`, `"mirror"`) and an odd finite `repeat`, the other one, since its last run goes
 * backwards. A run that repeats forever never ends, and lands where its first run does (Motion's
 * last keyframe).
 */
export const endOf = <A>(from: A, to: A, options: Machine.Modifiers): A => {
  const repeats = Option.getOrElse(Option.fromUndefinedOr(options.repeat), () => 0)
  const backwards = Bool.and(turns(options.repeatType), endsBackwards(repeats))
  return Bool.match(Bool.xor(backwards, options.reverse === true), { onTrue: () => from, onFalse: () => to })
}

/** {@link snap}'s options. */
export interface SnapOptions {
  /** Seconds to hold `from` before landing on `to`. Default 0. */
  readonly delay?: number
}

/**
 * Reduced motion's snap (ADR-0029): `from` until `delay` seconds have passed, then `to`, settled.
 * It lands on the tick a `Machine.delay` of the same length lets its run start, so a snapped key
 * lands with the keys that animate; with no delay, on its first tick. The held time counts each
 * tick's `dt` at most `Machine.MAX_DT`, as `Machine.delay` does. Its span is
 * `wardic.reducedMotion.snap`.
 */
export const snap = <A>(from: A, to: A, options: SnapOptions = {}): Machine.Machine<Frame.Frame<A>> => {
  const delay = Option.getOrElse(Option.fromUndefinedOr(options.delay), () => 0)
  return Machine.make({
    settles: true,
    span: { name: "wardic.reducedMotion.snap", attributes: { delay } },
    start: () => {
      const held: Frame.Frame<A> = { value: from, done: false }
      const settled: Frame.Frame<A> = { value: to, done: true }
      let elapsed = 0
      // Per frame (ADR-0025): a statement `if`, `Math.min`; both Frames built above.
      return (dt) => {
        elapsed += Math.min(dt, Machine.MAX_DT)
        if (elapsed < delay) return held
        return settled
      }
    },
  })
}
