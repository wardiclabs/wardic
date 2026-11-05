import type { JSX } from "@solidjs/web"
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import { DomLive } from "@wardic/dom"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import { domAnimation, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Layer from "effect/Layer"

/** One spring for every key: the same object each time, so the keys on it run together. */
const SPRING: DefaultTransition.Transition = { type: "spring", stiffness: 300, damping: 30 }

/**
 * Every key with no transition of its own on that spring, where the DOM's springs the transforms and
 * tweens the rest. Keyframes through more than two stops keep the DOM's tween.
 */
const oneSpring = Layer.succeed(DefaultTransition.DefaultTransition, {
  transitionFor: () => SPRING,
  keyframes: DomDefaultTransition.keyframes,
})

/** The DOM's Environment, its default transitions replaced: the later Layer wins. */
export const env = Layer.mergeAll(DomLive, oneSpring)

export default function App(props: { readonly children: JSX.Element }) {
  return (
    <WardicProvider env={env} features={[domAnimation]}>
      {props.children}
    </WardicProvider>
  )
}
