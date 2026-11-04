/**
 * `createFocus` (#548): in a module of its own, so it brings the `focus` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Feature } from "../../feature.ts"
import { focus } from "../../features/focus.ts"
import { FocusGesture } from "../../features/keys.ts"
import { serviceOf } from "../../gesture-features.ts"
import { useBrought } from "./provider.tsx"
import { type Sensor, watchSensorOf } from "./sensors.ts"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const FOCUS: ReadonlyArray<Feature> = [focus]

/** `true` while the element is focused, `false` once blurred (the core focus watch). */
export const createFocus = (): Sensor<boolean> => {
  const services = useBrought(FOCUS)
  return watchSensorOf<boolean>((target, handlers) => serviceOf(services(), FocusGesture).watch(target, {}, handlers), false)
}
