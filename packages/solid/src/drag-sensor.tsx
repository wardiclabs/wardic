/**
 * `createDrag` (#548): in a module of its own, so it brings the `drag` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type CreateDragOptions, watchDragSamples } from "./drag-samples.ts"
import type * as Feature from "@wardic/dom/unstable/Feature"
import * as DomDrag from "@wardic/dom/unstable/features/Drag"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import { type Accessor, useContext } from "solid-js"
import { useBrought } from "./provider.tsx"
import { isElement, type Sensor, stageSensorOf, wardSensorOf, watchSensorOf } from "./sensors.tsx"
import { type StageSubject, WardicStage } from "./stage.ts"
import { type AnyWard, isWard } from "./ward.tsx"
import { useWardicConfig } from "./wardic-config.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const DRAG: ReadonlyArray<Feature.Feature> = [DomDrag.drag]

/** `createDrag`'s forms: a sensor to give to a `ref`; or, given its element or a ward first, its reading. */
export interface CreateDrag {
  (options?: CreateDragOptions): Sensor<Drag.Sample | null>
  (element: Element, options?: CreateDragOptions): Accessor<Drag.Sample | null>
  (ward: AnyWard): Accessor<Drag.Sample | null>
  /** One of the Stage's Subjects, under a `<WardicStage>` (#885): its drags' pointer samples, through the scene's raycast. */
  (subject: StageSubject, options?: CreateDragOptions): Accessor<Drag.Sample | null>
}

/** A drag sensor's element, when its first argument is one. */
const elementOf = (first: unknown): Element | undefined => {
  if (isElement(first)) return first
  return undefined
}

/** A drag sensor's options: its second argument after an element, else its first. */
const optionsOf = (first: unknown, more: CreateDragOptions | undefined): CreateDragOptions | undefined => {
  if (isElement(first)) return more
  return first as CreateDragOptions | undefined
}

/**
 * The latest sample of a drag on the element it's given to as a `ref`, `null` before the first: where
 * the pointer is, how far it has come, its velocity, and the gesture's `phase`. It moves nothing: it
 * reports, for a drag that drives something else, such as a slider's value. Like an element's own
 * drag, it takes the element's drag while a gesture is on, unless `claim: false`. Given its element
 * first, it reads that one; given a ward, the ward's own drag, by its own config: a ward that doesn't
 * drag tells none. Under a `<WardicStage>`, given one of its Subjects, a mesh's, through the scene's raycast.
 *
 * @example
 * const drag = createDrag({ axis: "x" })
 * const value = () => (drag()?.offset.x ?? 0) / 2
 * <div class="track" ref={drag} />
 *
 * const card = ward({ drag: "x" })
 * const dragging = createDrag(card)
 * @see https://wardic.dev/reference/solid/gestures/create-drag
 */
// The core drag watch (#379), with `options`' axis, claim and bounds; the element's Drag claim held
// while a gesture is on. Given a ward (#884), the samples its own drag watch makes.
export const createDrag: CreateDrag = ((first?: CreateDragOptions | Element | AnyWard, more?: CreateDragOptions): Sensor<Drag.Sample | null> | Accessor<Drag.Sample | null> => {
  if (isWard(first)) {
    return wardSensorOf<Drag.Sample | null>(first, null, ({ lifecycle }, set) => [lifecycle.listenSamples(set)])
  }
  // One of the Stage's Subjects (#885's PR 4): core's drag watch on the Stage's input, as `createHover(mesh)`'s.
  // Only what the Stage takes: a plain object first is the sensor's options.
  const stage = useContext(WardicStage)
  if (Predicate.isNotNull(stage) && Bool.not(isElement(first)) && Bool.not(isWard(first)) && stage.isSubject(first)) {
    return UndefinedOr.match(
      stageSensorOf<Drag.Sample | null>("createDrag", first, null, (subject, handlers) => watchDragSamples(subject, { ...more }, handlers)),
      { onUndefined: () => () => null, onDefined: (sensed) => sensed },
    )
  }
  const target = elementOf(first)
  const options = optionsOf(first, more)
  // Its points through the nearest WardicConfig's `transformPagePoint` (#443), read at each down.
  const pagePoint = WardicConfigValue.transformPagePointOf(useWardicConfig())
  const services = useBrought(DRAG)
  return watchSensorOf<Drag.Sample | null>(
    (element, handlers) => Effect.provideService(watchDragSamples(element, { ...options }, handlers, pagePoint), InputSource.InputSource, GestureFeatures.inputIn(services())),
    null,
    target,
  )
}) as CreateDrag
