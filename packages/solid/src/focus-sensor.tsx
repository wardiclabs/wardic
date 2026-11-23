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
import { isServer } from "@solidjs/web"
import * as Predicate from "effect/Predicate"
import { type Accessor, createEffect } from "solid-js"
import { useBrought } from "./provider.tsx"
import { type Sensor, type PageTarget, watchSensorOf } from "./sensors.tsx"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import { isWard, sensedOf } from "./ward.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const FOCUS: ReadonlyArray<Feature.Feature> = [Focus.focus]

/** `createFocus`'s forms: a sensor to give to a `ref`; or, given its element or a ward first, its reading. */
export interface CreateFocus {
  (): Sensor<boolean>
  (target: PageTarget): Accessor<boolean>
}

/**
 * `true` while the element it's given to as a `ref` has focus, `false` once it loses it, however it
 * got it: a pointer's click counts, where `whileFocus` counts only a focus the browser shows. Given its
 * element first, it reads that one; given a ward, the element the ward is on.
 *
 * @example
 * const focused = createFocus()
 * <input ref={focused} />
 * <p class="hint" hidden={!focused()}>Press Enter to search</p>
 * @see https://wardic.dev/reference/solid/gestures/create-focus
 */
// The core focus watch, not `visible` only. Given a ward (#884), it watches the ward's element, following
// it: a ward tells no focus events, so its own focus recognizer, run for `whileFocus` alone, can't be asked.
export const createFocus: CreateFocus = ((target?: PageTarget): Sensor<boolean> | Accessor<boolean> => {
  const services = useBrought(FOCUS)
  if (isWard(target)) {
    const sensor = watchSensorOf<boolean>((element, handlers) => GestureFeatures.serviceOf(services(), Keys.FocusGesture).watch(element, {}, handlers), false)
    if (isServer) return () => sensor()
    const sensed = sensedOf(target)
    if (Predicate.isUndefined(sensed)) return () => sensor()
    createEffect(
      sensed.element,
      (element) => {
        if (Predicate.isNotUndefined(element)) sensor(element)
      },
      CLIENT_ONLY,
    )
    return () => sensor()
  }
  return watchSensorOf<boolean>((element, handlers) => GestureFeatures.serviceOf(services(), Keys.FocusGesture).watch(element, {}, handlers), false, target)
}) as CreateFocus
