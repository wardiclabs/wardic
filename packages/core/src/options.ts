/**
 * Shared option and value types for the engine.
 *
 * Convention: all durations and delays are in **seconds** (matching the public
 * `transition: { duration: 0.3 }` surface and the `dt` the Clock emits). The
 * plan's time-utility `delay(ms)` label is treated as seconds here for
 * consistency across the whole API.
 */

/** Easing function mapping normalized time `t` in [0, 1] to eased progress. */
export type Easing = (t: number) => number

/** A flat bag of animatable values (numbers or unit/color strings). */
export type Values = Record<string, number | string>

/** A named animation state. */
export type Variant = Record<string, number | string>

/** A map of variant name → values, propagated through the component tree. */
export type Variants = Record<string, Variant>

/** Options for a definite, duration-based animation. */
export interface TweenOptions {
  /** Duration in seconds. */
  readonly duration: number
  /** Easing function; defaults to linear. */
  readonly easing?: Easing
  /**
   * Delay before the animation starts, in seconds. With `animate`'s `repeat` / `yoyo`, or across
   * `keyframes`' stops, it holds once, before the first segment (#77).
   */
  readonly delay?: number
}

/** Options for interruptible spring motion. */
export interface SpringOptions {
  /** Starting position. Default 0. */
  readonly from?: number
  /** Spring constant — higher is snappier. Default 170. */
  readonly stiffness?: number
  /** Damping — higher settles faster with less overshoot. Default 26. */
  readonly damping?: number
  /** Mass of the moving object. Default 1. */
  readonly mass?: number
  /** Initial velocity (units/second). Default 0. */
  readonly velocity?: number
  /** Rest threshold for position delta from target. Default 0.01. */
  readonly restDelta?: number
  /** Rest threshold for velocity. Default 0.01. */
  readonly restVelocity?: number
  /** Delay before the animation starts, in seconds. */
  readonly delay?: number
}

/** Options for momentum/decay motion (fling math). */
export interface DecayOptions {
  /** Exponential friction coefficient — higher stops sooner. Default 3. */
  readonly friction?: number
  /** Velocity below which motion is considered at rest. Default 0.1. */
  readonly restVelocity?: number
  /** Delay before the animation starts, in seconds. */
  readonly delay?: number
}

/** Repeat / lifecycle modifiers shared across primitives. */
export interface Modifiers {
  /**
   * Additional repeats after the first run. `Infinity` loops forever. Default 0. Each repeat
   * starts on the tick after the one before it settles, with no gap: `delay` holds once, before
   * the first run (#77); a gap between repeats (Motion's `repeatDelay`) is #91.
   */
  readonly repeat?: number
  /** Reverse direction on alternate repeats (ping-pong). Default false. */
  readonly yoyo?: boolean
  /** Run the animation from `to` back to `from`. Default false. */
  readonly reverse?: boolean
}

/** Options accepted by the scalar/multi `animate` primitive. */
export interface AnimateOptions extends TweenOptions, Modifiers {}
