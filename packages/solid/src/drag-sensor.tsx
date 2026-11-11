/**
 * `createDrag` (#548): in a module of its own, so it brings the `drag` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import type { Accessor } from "solid-js"
import { watchToSignal } from "./bridge.tsx"
import { type CreateDragOptions, watchDragSamples } from "./drag-samples.ts"
import type { Feature } from "./feature.ts"
import { drag } from "./features/drag.ts"
import { inputIn } from "./gesture-features.ts"
import { useBrought } from "./provider.tsx"
import { useWardicConfig } from "./wardic-config.tsx"
import { transformPagePointOf } from "./wardic-config-value.ts"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const DRAG: ReadonlyArray<Feature> = [drag]

/**
 * The latest sample of a drag on `target`, `null` before the first: where the pointer is, how far it
 * has come, its velocity, and the gesture's `phase`. It moves nothing: it reports, for a drag that
 * drives something else, such as a slider's value. `target` is the element itself, so call it where
 * it exists. Like an element's own drag, it takes the element's drag while a gesture is on, unless
 * `claim: false`.
 *
 * @example
 * const drag = createDrag(props.track, { axis: "x" })
 * const value = () => (drag()?.offset.x ?? 0) / 2
 * @see https://wardic.dev/reference/solid/gestures/create-drag
 */
// The core drag watch (#379), each sample kept within `bounds` when given. It holds `target`'s Drag
// claim while a gesture is on, shared with every other drag on it; refused one, it gets no samples for
// that gesture.
export const createDrag = (target: unknown, options?: CreateDragOptions): Accessor<Drag.Sample | null> => {
  // Its points through the nearest WardicConfig's `transformPagePoint` (#443), read at each down.
  const pagePoint = transformPagePointOf(useWardicConfig())
  const services = useBrought(DRAG)
  return watchToSignal<Drag.Sample | null>(
    (handlers) => Effect.provideService(watchDragSamples(target, { ...options }, handlers, pagePoint), InputSource.InputSource, inputIn(services())),
    null,
  )
}
