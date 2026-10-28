/**
 * The `DefaultTransition` module: what a key runs on when its own transition isn't defined
 * (CONTEXT.md **Default transition**; ADR-0051).
 *
 * Motion picks a default by value (`default-transitions.ts`, `getDefaultTransition`, at 16c6122): its
 * springs for the transforms, a short ease for the rest. Which values are which is an Environment's
 * to say, so the choice is too (#357): core defines the contract, {@link DefaultTransition}, and an
 * Environment provides it (the DOM's is Motion's table: `@wardic/dom`'s `DomDefaultTransition`). One
 * with no opinion, the Test Environment's, provides {@link oneSpring}. A binding reads it once, as it
 * reads the Positional keys, and asks it for each key whose transition isn't defined: its
 * `keyframes` for a key through more than two stops, as Motion's (#429).
 *
 * Tier 2 (ADR-0008), for binding authors.
 */
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import type * as Machine from "./Machine.ts"

/** A transition a key runs on: a spring, or a tween. */
export type Transition = ({ readonly type: "spring" } & Machine.SpringOptions) | ({ readonly type: "tween" } & Machine.AnimateOptions)

/** A transition a key runs on through its stops (#429): a tween, as Motion's keyframes are, an `ease` per Segment if it likes. */
export type KeyframesTransition = { readonly type: "tween" } & Machine.KeyframesOptions

/**
 * An Environment's **Default transition** (CONTEXT.md; ADR-0051): the transition a key runs on
 * when its own isn't defined.
 */
export class DefaultTransition extends Context.Service<DefaultTransition, {
  /**
   * The transition `key` runs on toward `target`. The same object for the same answer: a binding
   * runs the keys that share one on one leg, and core's decode cache hits (#66).
   */
  readonly transitionFor: (key: string, target: number | string) => Transition
  /**
   * The transition a key runs on through more than two stops (#429, Motion's `keyframesTransition`):
   * one for every key, as Motion's is. A key with two runs on {@link transitionFor}'s, toward its last.
   */
  readonly keyframes: KeyframesTransition
}>()("@wardic/DefaultTransition") {}

/** One spring with core's defaults (`Machine.SpringOptions`: 170 / 26 / 1). */
export const ONE_SPRING: Transition = { type: "spring" }

/** One tween with core's defaults (`Machine.KeyframesOptions`: 0.3 s, linear): {@link oneSpring}'s keyframes (#429). */
export const ONE_TWEEN: KeyframesTransition = { type: "tween" }

/**
 * An Environment with no opinion's Default transition: every key on {@link ONE_SPRING}, and more than
 * two stops on {@link ONE_TWEEN} (#429).
 */
export const oneSpring: Layer.Layer<DefaultTransition> = Layer.succeed(DefaultTransition, { transitionFor: () => ONE_SPRING, keyframes: ONE_TWEEN })
