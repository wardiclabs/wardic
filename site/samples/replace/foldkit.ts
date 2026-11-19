import * as DefaultTransition from "@wardic/core/DefaultTransition"
import { DomLive } from "@wardic/dom"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import * as Layer from "effect/Layer"
import { Features, Wardic } from "@wardic/foldkit"

/** One spring for every key: the same object each time, so the keys on it run together. */
const SPRING: DefaultTransition.Transition = { type: "spring", stiffness: 300, damping: 30 }

/**
 * Every key with no transition of its own on that spring, where the DOM's springs the transforms and
 * tweens the rest. Keyframes through more than two stops keep the DOM's tween.
 */
const layerOneSpring = Layer.succeed(DefaultTransition.DefaultTransition, {
  transitionFor: () => SPRING,
  keyframes: DomDefaultTransition.keyframes,
})

/** The DOM's Environment, its default transitions replaced: the later Layer wins. */
export const env = Layer.mergeAll(DomLive, layerOneSpring)

/** The app's Handle, on that Environment: `src/lib/wardic.ts`. */
export const wardic = Wardic.make({ env, features: Features.domAnimation })
