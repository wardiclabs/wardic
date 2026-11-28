/**
 * The DOM Environment's Default transition (CONTEXT.md; ADR-0051, #357): Motion's, by value
 * (`.reference/motion` at 16c6122, `motion-dom/src/animation/utils/default-transitions.ts`,
 * `getDefaultTransition`):
 * - a transform but a scale, the element's own depth (`transformPerspective`) among them: a spring,
 *   500 / 25, at rest under 10 px/s;
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
// #882 (ADR-0073, *Amendment (#882)*, Q2): core's table, `DefaultTransition.byKey`, the same objects.
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Layer from "effect/Layer"
import * as TransformKeys from "./transform-keys.ts"

/** The transition through more than two keyframes, as Motion's `keyframesTransition`: a 0.8 s tween, eased out. */
export const keyframes: DefaultTransition.KeyframesTransition = DefaultTransition.KEYFRAMES_TWEEN

/** The key whose transition the element's own depth runs on: a turn's, so a depth and a turn leaving together decay in step. */
const DEPTH_RUNS_AS = "rotateY"

/** The transition `key` runs on toward `target` when its own isn't defined, in the DOM: Motion's. */
// #887 (ADR-0073, *Amendment (#887)*, Q10): core's `byKey` knows core's transforms. The DOM's own depth takes
// a turn's, the same object.
export const transitionFor = (key: string, target: number | string): DefaultTransition.Transition => {
  if (key === TransformKeys.PERSPECTIVE) return DefaultTransition.byKey(DEPTH_RUNS_AS, target)
  return DefaultTransition.byKey(key, target)
}

/** The DOM Environment's `DefaultTransition.DefaultTransition`. */
export const DefaultTransitionDomLive: Layer.Layer<DefaultTransition.DefaultTransition> = /*#__PURE__*/ Layer.succeed(DefaultTransition.DefaultTransition, { transitionFor, keyframes })
