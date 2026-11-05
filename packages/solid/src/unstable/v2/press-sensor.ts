/**
 * `createPress` (#548): in a module of its own, so it brings the `press` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Feature } from "../../feature.ts"
import { press } from "../../features/press.ts"
import { PressGesture } from "../../features/keys.ts"
import { serviceOf } from "../../gesture-features.ts"
import { useBrought } from "./provider.tsx"
import { type Sensor, watchSensorOf } from "./sensors.ts"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const PRESS: ReadonlyArray<Feature> = [press]

/**
 * `true` while the element it's given to as a `ref` is pressed, by a pointer held down on it or by
 * Enter or Space while it has focus, `false` once it's released or the press is cancelled. An element
 * that takes no focus of itself is given `tabindex="0"`, so a keyboard can press it.
 *
 * @example
 * const pressed = createPress()
 * <button ref={pressed}>{pressed() ? "Holding" : "Press and hold"}</button>
 * @see https://wardic.dev/reference/solid/gestures/create-press
 */
// The core press watch; a Keyboard press (#427).
export const createPress = (): Sensor<boolean> => {
  const services = useBrought(PRESS)
  return watchSensorOf<boolean>((target, { on, onDefect }) => serviceOf(services(), PressGesture).watch(target, { on: (press) => on(press.phase === "start"), onDefect }), false)
}
