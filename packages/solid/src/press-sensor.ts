/**
 * `createPress` (#548): in a module of its own, so it brings the `press` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Accessor } from "solid-js"
import { watchToSignal } from "./bridge.ts"
import type { Feature } from "./feature.ts"
import { press } from "./features/press.ts"
import { PressGesture } from "./features/keys.ts"
import { serviceOf } from "./gesture-features.ts"
import { useBrought } from "./provider.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const PRESS: ReadonlyArray<Feature> = [press]

/**
 * `true` while `target` is pressed, by a pointer held down on it or by Enter or Space while it has
 * focus, `false` once it's released or the press is cancelled. `target` is the element itself, so call
 * it where it exists. An element that takes no focus of itself is given `tabindex="0"`, so a keyboard
 * can press it.
 *
 * @example
 * const pressed = createPress(props.button)
 * <span>{pressed() ? "Holding" : "Press and hold"}</span>
 * @see https://wardic.dev/reference/solid/gestures/create-press
 */
// The core press watch (#318); a Keyboard press (#427). `false` until its first transition.
export const createPress = (target: unknown): Accessor<boolean> => {
  const services = useBrought(PRESS)
  return watchToSignal<boolean>(({ on, onDefect }) => serviceOf(services(), PressGesture).watch(target, { on: (press) => on(press.phase === "start"), onDefect }), false)
}
