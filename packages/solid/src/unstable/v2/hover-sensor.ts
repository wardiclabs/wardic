/**
 * `createHover` (#548): in a module of its own, so it brings the `hover` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Feature } from "../../feature.ts"
import { hover } from "../../features/hover.ts"
import { HoverGesture } from "../../features/keys.ts"
import { serviceOf } from "../../gesture-features.ts"
import { useBrought } from "./provider.tsx"
import { type Sensor, watchSensorOf } from "./sensors.ts"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const HOVER: ReadonlyArray<Feature> = [hover]

/** `true` while the pointer is over the element, `false` once it leaves (the core hover watch). */
export const createHover = (): Sensor<boolean> => {
  const services = useBrought(HOVER)
  return watchSensorOf<boolean>((target, { on, onDefect }) => serviceOf(services(), HoverGesture).watch(target, { on: (transition) => on(transition.active), onDefect }), false)
}
