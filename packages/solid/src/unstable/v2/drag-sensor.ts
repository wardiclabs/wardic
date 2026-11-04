/**
 * `createDrag` (#548): in a module of its own, so it brings the `drag` Feature only to an app that uses it,
 * and on the pages that do (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import { type CreateDragOptions, watchDragSamples } from "../../drag-samples.ts"
import type { Feature } from "../../feature.ts"
import { drag } from "../../features/drag.ts"
import { inputIn } from "../../gesture-features.ts"
import { transformPagePointOf } from "../../wardic-config-value.ts"
import { useBrought } from "./provider.tsx"
import { type Sensor, watchSensorOf } from "./sensors.ts"
import { useWardicConfig } from "./wardic-config.tsx"

/** What it brings (ADR-0067 decision 12): its gesture's Feature, whatever its section has (#511). */
const DRAG: ReadonlyArray<Feature> = [drag]

/**
 * The latest sample of a drag gesture on the element, `null` before the first: the core drag watch
 * (#379) with `options`' axis, claim and bounds. Like an element's own drag, it holds the
 * element's **Drag claim** while a gesture is on, unless `claim: false`.
 */
export const createDrag = (options?: CreateDragOptions): Sensor<Drag.Sample | null> => {
  // Its points through the nearest WardicConfig's `transformPagePoint` (#443), read at each down.
  const pagePoint = transformPagePointOf(useWardicConfig())
  const services = useBrought(DRAG)
  return watchSensorOf<Drag.Sample | null>(
    (target, handlers) => Effect.provideService(watchDragSamples(target, { ...options }, handlers, pagePoint), InputSource.InputSource, inputIn(services())),
    null,
  )
}
