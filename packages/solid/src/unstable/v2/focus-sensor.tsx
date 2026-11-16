/**
 * `createFocus` (#548): in a module of its own, so it brings the `focus` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as Feature from "@wardic/dom/unstable/Feature"
import * as Focus from "@wardic/dom/unstable/features/Focus"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import { useBrought } from "./provider.tsx"
import { type Sensor, watchSensorOf } from "./sensors.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const FOCUS: ReadonlyArray<Feature.Feature> = [Focus.focus]

/**
 * `true` while the element it's given to as a `ref` has focus, `false` once it loses it, however it
 * got it: a pointer's click counts, where `whileFocus` counts only a focus the browser shows.
 *
 * @example
 * const focused = createFocus()
 * <input ref={focused} />
 * <p class="hint" hidden={!focused()}>Press Enter to search</p>
 * @see https://wardic.dev/reference/solid/gestures/create-focus
 */
// The core focus watch, not `visible` only.
export const createFocus = (): Sensor<boolean> => {
  const services = useBrought(FOCUS)
  return watchSensorOf<boolean>((target, handlers) => GestureFeatures.serviceOf(services(), Keys.FocusGesture).watch(target, {}, handlers), false)
}
