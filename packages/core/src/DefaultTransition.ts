/**
 * What a key runs on when its own transition isn't defined. Which keys get what is an Environment's to
 * say, as Motion picks by value: `@wardic/dom`'s gives the transforms springs and the rest a short tween. A
 * binding asks it for each key that has no transition, and for keyframes through more than two stops.
 *
 * @example
 * import * as DefaultTransition from "@wardic/core/DefaultTransition"
 *
 * const defaults = yield* DefaultTransition.DefaultTransition
 * defaults.transitionFor("x", 100) // `byKey`'s, `@wardic/dom`'s: a spring
 * defaults.transitionFor("opacity", 1) // `byKey`'s: a 0.3 s tween
 */
// CONTEXT.md **Default transition**; ADR-0051. Motion's `getDefaultTransition` (default-transitions.ts at
// 16c6122). Core defines the contract and an Environment provides it (#357): `@wardic/dom`'s is Motion's table,
// its `DomDefaultTransition`; one with no opinion, the Test Environment's, `oneSpring`. A
// binding reads it once, as it reads the Positional keys; its `keyframes` for more than two stops, as
// Motion's (#429). Tier 2 (ADR-0008), for binding authors.
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as BaseValue from "./BaseValue.ts"
import type * as Machine from "./Machine.ts"

/** A transition a key runs on: a spring, or a tween. */
export type Transition = ({ readonly type: "spring" } & Machine.SpringOptions) | ({ readonly type: "tween" } & Machine.AnimateOptions)

/** A transition a key runs on through its stops: a tween, as Motion's keyframes are, with an `ease` per stretch if it likes. */
// #429.
export type KeyframesTransition = { readonly type: "tween" } & Machine.KeyframesOptions

/** An Environment's Default transition: the transition a key runs on when its own isn't defined. */
// CONTEXT.md; ADR-0051.
export class DefaultTransition extends Context.Service<DefaultTransition, {
  /**
   * The transition `key` runs on toward `target`. The same object for the same answer, so a binding can
   * run the keys that share one together.
   */
  // Core's decode cache hits on it too (#66).
  readonly transitionFor: (key: string, target: number | string) => Transition
  /**
   * The transition a key runs on through more than two stops, one for every key, as Motion's
   * `keyframesTransition` is. A key with two stops runs on `transitionFor`'s, toward its last.
   */
  // #429.
  readonly keyframes: KeyframesTransition
}>()("@wardic/core/DefaultTransition") {}

/** One spring with core's defaults: stiffness 170, damping 26, mass 1. */
export const ONE_SPRING: Transition = { type: "spring" }

/** One tween with core's defaults, 0.3 s and linear: `oneSpring`'s for more than two stops. */
// #429.
export const ONE_TWEEN: KeyframesTransition = { type: "tween" }

/**
 * A Default transition with no opinion: every key on `ONE_SPRING`, and more than two stops on
 * `ONE_TWEEN`. The Test Environment's.
 *
 * @example
 * program.pipe(Effect.provide(DefaultTransition.layerOneSpring))
 */
// #429.
export const layerOneSpring: Layer.Layer<DefaultTransition> = /*#__PURE__*/ Layer.succeed(DefaultTransition, { transitionFor: () => ONE_SPRING, keyframes: ONE_TWEEN })

/** A transform's but a scale's: Motion's `underDampedSpring`. */
const TRANSFORM: Transition = { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 }

/** A scale's toward 0: Motion's `criticallyDampedSpring`, critically damped, so it doesn't overshoot past 0. */
const SCALE_TO_ZERO: Transition = { type: "spring", stiffness: 550, damping: 2 * Math.sqrt(550), restSpeed: 10 }

/** A scale's toward anything else: Motion's `criticallyDampedSpring`, with its damping of 30. */
const SCALE: Transition = { type: "spring", stiffness: 550, damping: 30, restSpeed: 10 }

/** Every other key's: Motion's `ease`. */
const EASE: Transition = { type: "tween", duration: 0.3, ease: [0.25, 0.1, 0.35, 1] }

/** The transition through more than two stops by key, as Motion's `keyframesTransition`: a 0.8 s tween, eased out. */
// #429: on its `animateMotionValue`'s `easeOut`.
export const KEYFRAMES_TWEEN: KeyframesTransition = { type: "tween", duration: 0.8, ease: "easeOut" }

/** A transform's: a scale's, by its target, or the rest's. */
const transformFor = (key: string, target: number | string): Transition =>
  Bool.match(key.startsWith("scale"), {
    onTrue: () => Bool.match(target === 0, { onTrue: () => SCALE_TO_ZERO, onFalse: () => SCALE }),
    onFalse: () => TRANSFORM,
  })

/**
 * The transition `key` runs on toward `target` by its name, as Motion picks it: a transform but a scale
 * (`x`, `rotate`, `rotateY`…) on a spring of 500 / 25, at rest under 10 a second; a scale on a spring of
 * 550, critically damped toward 0, else damped 30; any other key on a 0.3 s tween, eased by the cubic
 * Bézier (0.25, 0.1, 0.35, 1). The same object for the same answer.
 *
 * @example
 * DefaultTransition.byKey("x", 100) // { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 }
 * DefaultTransition.byKey("uProgress", 1) // a 0.3 s tween
 */
// Motion's `getDefaultTransition` (`motion-dom/src/animation/utils/default-transitions.ts` at 16c6122).
// #882 (ADR-0073, *Amendment (#882)*, Q2): dom's table (ADR-0051, #357), moved here, so a scene's keys run
// on what the page's do (ADR-0073, decision 22); dom's `DomDefaultTransition` is this.
export const byKey = (key: string, target: number | string): Transition =>
  Bool.match(Option.isSome(BaseValue.transformIdentity(key)), { onTrue: () => transformFor(key, target), onFalse: () => EASE })

/**
 * The Default transition by key: {@link byKey} for each key, and {@link KEYFRAMES_TWEEN} through more
 * than two stops. `@wardic/dom`'s, and `@wardic/object`'s.
 *
 * @example
 * program.pipe(Effect.provide(DefaultTransition.layerByKey))
 */
export const layerByKey: Layer.Layer<DefaultTransition> = /*#__PURE__*/ Layer.succeed(DefaultTransition, { transitionFor: byKey, keyframes: KEYFRAMES_TWEEN })
