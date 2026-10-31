/**
 * A drag's constraints as an app gives them (#273, ADR-0047), Solid-free: Motion's bounding box of
 * numbers, or the container its box must stay inside, an accessor read at each measure, with Motion's
 * `onMeasureDragConstraints`. Both bindings turn them into the drag track's: core's `Drag.Bounds`, or a
 * container the track measures ({@link DragContainer}).
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { constUndefined } from "effect/Function"
import type { WardicTransformPoint } from "./config.ts"

/** A box's edges, as Motion's `BoundingBox`: on x, `left` and `right`; on y, `top` and `bottom`. */
export interface WardicBoundingBox {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * `dragConstraints` (#273, ADR-0047, Motion's): the range of the element's x (`left` to `right`) and y
 * (`top` to `bottom`), an edge left out unbounded; the container its box must stay inside, an accessor
 * read at each measure (a drag's start, a resize of either); or `false`, none.
 */
export type WardicDragConstraints = false | Partial<WardicBoundingBox> | (() => Element | undefined)

/** Motion's `onMeasureDragConstraints`: the bounds measured against the container in, its own out, or none to keep them. */
export type WardicMeasureDragConstraints = (constraints: WardicBoundingBox) => WardicBoundingBox | undefined | void

/**
 * An element constraint, as the drag track takes it: its container, read at each measure, and the
 * bounds measured against it, the app's `onMeasureDragConstraints` applied.
 */
export interface DragContainer {
  readonly element: () => Element | undefined
  readonly bounds: (container: Element) => Drag.Bounds
}

/** An axis range from its two edges, either left out. */
const rangeOf = (min: number | undefined, max: number | undefined): Drag.AxisRange => ({
  ...UndefinedOr.match(min, { onUndefined: () => ({}), onDefined: (edge) => ({ min: edge }) }),
  ...UndefinedOr.match(max, { onUndefined: () => ({}), onDefined: (edge) => ({ max: edge }) }),
})

/** Motion's box as core's bounds: x from `left` to `right`, y from `top` to `bottom`. */
export const boundsOfBox = (box: Partial<WardicBoundingBox>): Drag.Bounds => ({ x: rangeOf(box.left, box.right), y: rangeOf(box.top, box.bottom) })

/** An edge of measured bounds, which has both. */
const edge = (value: number | undefined): number => UndefinedOr.match(value, { onUndefined: () => 0, onDefined: (n) => n })

/** A measured axis's two edges. */
const edgesOf = (range: Drag.AxisRange | undefined): readonly [number, number] =>
  UndefinedOr.match(range, { onUndefined: () => [0, 0] as const, onDefined: (r) => [edge(r.min), edge(r.max)] as const })

/** Measured bounds as Motion's box, for `onMeasureDragConstraints`. */
const boxOfBounds = (bounds: Drag.Bounds): WardicBoundingBox => {
  const [left, right] = edgesOf(bounds.x)
  const [top, bottom] = edgesOf(bounds.y)
  return { left, right, top, bottom }
}

/** What a drag track takes from an element's `dragConstraints`. */
export interface TrackConstraints {
  readonly constraints?: Drag.Bounds | undefined
  readonly container?: DragContainer | undefined
}

const NONE: TrackConstraints = {}

/**
 * The drag track's constraints from `dragConstraints`: Motion's box as bounds, or a container measured
 * against `element`, `onMeasure` read at each measure.
 */
export const trackConstraintsOf = (
  constraints: WardicDragConstraints | undefined,
  element: HTMLElement,
  onMeasure: () => WardicMeasureDragConstraints | undefined,
  mapPoint: () => WardicTransformPoint | undefined = constUndefined,
): TrackConstraints => {
  if (Predicate.isUndefined(constraints)) return NONE
  if (constraints === false) return NONE
  if (Predicate.isFunction(constraints)) {
    return {
      container: {
        element: constraints,
        bounds: (container) => {
          // Its boxes through the nearest config's `transformPagePoint` (#443), read at each measure.
          const measured = ProjectionSystem.dragBoundsWithin(element, container, mapPoint())
          return UndefinedOr.match(onMeasure(), {
            onUndefined: () => measured,
            onDefined: (adjust) =>
              UndefinedOr.match(adjust(boxOfBounds(measured)) as WardicBoundingBox | undefined, { onUndefined: () => measured, onDefined: boundsOfBox }),
          })
        },
      },
    }
  }
  return { constraints: boundsOfBox(constraints) }
}
