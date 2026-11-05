/**
 * What a key runs on when its own transition isn't defined. Which keys get what is an Environment's to
 * say, as Motion picks by value: `@wardic/dom`'s gives the transforms springs and the rest a short tween. A
 * binding asks it for each key that has no transition, and for keyframes through more than two stops.
 *
 * @example
 * import * as DefaultTransition from "@wardic/core/DefaultTransition"
 *
 * const defaults = yield* DefaultTransition.DefaultTransition
 * defaults.transitionFor("x", 100) // `@wardic/dom`'s: a spring
 * defaults.transitionFor("opacity", 1) // `@wardic/dom`'s: a 0.3 s tween
 */
// CONTEXT.md **Default transition**; ADR-0051. Motion's `getDefaultTransition` (default-transitions.ts at
// 16c6122). Core defines the contract and an Environment provides it (#357): `@wardic/dom`'s is Motion's table,
// its `DomDefaultTransition`; one with no opinion, the Test Environment's, `oneSpring`. A
// binding reads it once, as it reads the Positional keys; its `keyframes` for more than two stops, as
// Motion's (#429). Tier 2 (ADR-0008), for binding authors.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
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
}>()("@wardic/DefaultTransition") {}

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
 * program.pipe(Effect.provide(DefaultTransition.oneSpring))
 */
// #429.
export const oneSpring: Layer.Layer<DefaultTransition> = Layer.succeed(DefaultTransition, { transitionFor: () => ONE_SPRING, keyframes: ONE_TWEEN })
