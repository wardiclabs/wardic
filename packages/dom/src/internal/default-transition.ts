/**
 * The DOM Environment's Default transition (CONTEXT.md; ADR-0051, #357): Motion's, by value
 * (`.reference/motion` at 16c6122, `motion-dom/src/animation/utils/default-transitions.ts`,
 * `getDefaultTransition`):
 * - a transform but a scale: a spring, 500 / 25, at rest under 10 px/s;
 * - `scale`, `scaleX`, `scaleY`: a spring, 550, critically damped toward 0 (2·√550), else 30;
 * - anything else (opacity, colours, a box's size, a filter): a 0.3 s tween on
 *   `cubic-bezier(0.25, 0.1, 0.35, 1)`, "a slightly shallower version of the browser's default ease".
 *
 * - more than two keyframes (#429): Motion's `keyframesTransition`, a 0.8 s tween, each Interval on
 *   `easeOut`, the `ease` Motion's `animateMotionValue` gives every value before its default.
 *
 * `DomLive` provides the Layer.
 *
 * @module
 */
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Bool from "effect/Boolean"
import * as Layer from "effect/Layer"

/** A transform's but a scale's: Motion's `underDampedSpring`. */
const TRANSFORM: DefaultTransition.Transition = { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 }

/** A scale's toward 0: Motion's `criticallyDampedSpring`, critically damped, so it doesn't overshoot past 0. */
const SCALE_TO_ZERO: DefaultTransition.Transition = { type: "spring", stiffness: 550, damping: 2 * Math.sqrt(550), restSpeed: 10 }

/** A scale's toward anything else: Motion's `criticallyDampedSpring`, with its damping of 30. */
const SCALE: DefaultTransition.Transition = { type: "spring", stiffness: 550, damping: 30, restSpeed: 10 }

/** Every other key's: Motion's `ease`. */
const EASE: DefaultTransition.Transition = { type: "tween", duration: 0.3, ease: [0.25, 0.1, 0.35, 1] }

/** The transition through more than two keyframes, as Motion's `keyframesTransition`: a 0.8 s tween, eased out. */
// #429: on its `animateMotionValue`'s `easeOut`.
export const keyframes: DefaultTransition.KeyframesTransition = { type: "tween", duration: 0.8, ease: "easeOut" }

/** A transform's: a scale's, by its target, or the rest's. */
const transformFor = (key: string, target: number | string): DefaultTransition.Transition =>
  Bool.match(key.startsWith("scale"), {
    onTrue: () => Bool.match(target === 0, { onTrue: () => SCALE_TO_ZERO, onFalse: () => SCALE }),
    onFalse: () => TRANSFORM,
  })

/** The transition `key` runs on toward `target` when its own isn't defined, in the DOM: Motion's. */
export const transitionFor = (key: string, target: number | string): DefaultTransition.Transition =>
  Bool.match(ReducedMotion.isTransform(key), { onTrue: () => transformFor(key, target), onFalse: () => EASE })

/** The DOM Environment's `DefaultTransition.DefaultTransition`. */
export const DefaultTransitionDomLive: Layer.Layer<DefaultTransition.DefaultTransition> = Layer.succeed(DefaultTransition.DefaultTransition, { transitionFor, keyframes })
