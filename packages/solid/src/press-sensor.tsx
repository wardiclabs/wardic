/**
 * `createPress` (#548): in a module of its own, so it brings the `press` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as Feature from "@wardic/dom/unstable/Feature"
import * as Press from "@wardic/dom/unstable/features/Press"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import type { Accessor } from "solid-js"
import { useBrought } from "./provider.tsx"
import { type Sensor, type SensorTarget, told, wardSensorOf, watchSensorOf } from "./sensors.tsx"
import { isWard } from "./ward.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const PRESS: ReadonlyArray<Feature.Feature> = [Press.press]

/** `createPress`'s forms: a sensor to give to a `ref`; or, given its element or a ward first, its reading. */
export interface CreatePress {
  (): Sensor<boolean>
  (target: SensorTarget): Accessor<boolean>
}

/**
 * `true` while the element it's given to as a `ref` is pressed, by a pointer held down on it or by
 * Enter or Space while it has focus, `false` once it's released or the press is cancelled. An element
 * that takes no focus of itself is given `tabindex="0"`, so a keyboard can press it. Given its element
 * first, it reads that one; given a ward, the ward's own press, which a drag ends.
 *
 * @example
 * const pressed = createPress()
 * <button ref={pressed}>{pressed() ? "Holding" : "Press and hold"}</button>
 * @see https://wardic.dev/reference/solid/gestures/create-press
 */
// The core press watch; a Keyboard press (#427). Given a ward, its `pressStart`, `tap` and `tapCancel`
// (#884), and its `dragStart`: a press a drag takes over tells neither of the others.
export const createPress: CreatePress = ((target?: SensorTarget): Sensor<boolean> | Accessor<boolean> => {
  const services = useBrought(PRESS)
  if (isWard(target)) {
    return wardSensorOf(target, false, ({ lifecycle }, set) => [
      lifecycle.listen("pressStart", told(() => set(true))),
      lifecycle.listen("tap", told(() => set(false))),
      lifecycle.listen("tapCancel", told(() => set(false))),
      lifecycle.listen("dragStart", told(() => set(false))),
    ])
  }
  return watchSensorOf<boolean>((element, { on, onDefect }) => GestureFeatures.serviceOf(services(), Keys.PressGesture).watch(element, { on: (press) => on(press.phase === "start"), onDefect }), false, target)
}) as CreatePress
