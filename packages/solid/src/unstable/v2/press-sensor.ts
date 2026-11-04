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
 * `true` while the pointer is held down on the element, or a **Keyboard press** holds Enter or Space
 * on it (#427, the element made focusable for one), `false` once released or cancelled (the core
 * press watch).
 */
export const createPress = (): Sensor<boolean> => {
  const services = useBrought(PRESS)
  return watchSensorOf<boolean>((target, { on, onDefect }) => serviceOf(services(), PressGesture).watch(target, { on: (press) => on(press.phase === "start"), onDefect }), false)
}
