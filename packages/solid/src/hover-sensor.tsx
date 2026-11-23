/**
 * `createHover` (#548): in a module of its own, so it brings the `hover` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as Feature from "@wardic/dom/unstable/Feature"
import * as Hover from "@wardic/dom/unstable/features/Hover"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import type { Accessor } from "solid-js"
import { useBrought } from "./provider.tsx"
import { type Sensor, type SensorTarget, told, wardSensorOf, watchSensorOf } from "./sensors.tsx"
import { isWard } from "./ward.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const HOVER: ReadonlyArray<Feature.Feature> = [Hover.hover]

/** `createHover`'s forms: a sensor to give to a `ref`; or, given its element or a ward first, its reading. */
export interface CreateHover {
  (): Sensor<boolean>
  (target: SensorTarget): Accessor<boolean>
}

/**
 * `true` while the pointer is over the element it's given to as a `ref`, `false` once it leaves: a
 * hover as state, for what isn't an animation, where `whileHover` would do. A touch never hovers. Given
 * its element first, it reads that one; given a ward, the ward's own hover.
 *
 * @example
 * const hovered = createHover()
 * <article ref={hovered}>{hovered() ? "Over" : "Away"}</article>
 *
 * const card = ward({ whileHover: { scale: 1.05 } })
 * const over = createHover(card)
 * @see https://wardic.dev/reference/solid/gestures/create-hover
 */
// The core hover watch; given a ward, its `hoverStart` and `hoverEnd` (#884).
export const createHover: CreateHover = ((target?: SensorTarget): Sensor<boolean> | Accessor<boolean> => {
  const services = useBrought(HOVER)
  if (isWard(target)) return wardSensorOf(target, false, ({ lifecycle }, set) => [lifecycle.listen("hoverStart", told(() => set(true))), lifecycle.listen("hoverEnd", told(() => set(false)))])
  return watchSensorOf<boolean>((element, { on, onDefect }) => GestureFeatures.serviceOf(services(), Keys.HoverGesture).watch(element, { on: (transition) => on(transition.active), onDefect }), false, target)
}) as CreateHover
