/**
 * An element's drag transition (ADR-0016, *Amendment (#140)*), Solid-free (#209): what every release
 * runs on, a Fling, a snap back to the origin, and a layout node's Release offset, in both bindings.
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicDragTransition } from "./config.ts"

/** Motion's `dragElastic` default (`defaultElastic`, ADR-0016 *Amendment (#140)*). */
export const DEFAULT_DRAG_ELASTIC = 0.35

/** A drag's `dragElastic`, or Motion's default. */
export const elasticOf = (elastic: number | undefined): number =>
  UndefinedOr.match(elastic, { onUndefined: () => DEFAULT_DRAG_ELASTIC, onDefined: identity })

/** Motion's release (`startAnimation`), in seconds: a 0.75 s time constant, power 0.8, at rest within 1 px and 10 px/s. */
const MOTION_RELEASE = { power: 0.8, timeConstant: 0.75, restDelta: 1, restSpeed: 10 } as const
/** The bounce with an elastic drag, Motion's `dragElastic ? 200 : …`. */
const ELASTIC_BOUNCE = { bounceStiffness: 200, bounceDamping: 40 } as const
/** The bounce with none, a wall: Motion's `… : 1000000` and `10000000`. */
const RIGID_BOUNCE = { bounceStiffness: 1e6, bounceDamping: 1e7 } as const

/**
 * An element's drag transition, resolved (ADR-0016, *Amendment (#140)*): Motion's release, its bounce
 * from `dragElastic` (a wall with none), then the element's own `dragTransition` over it, its
 * `timeConstant` from milliseconds to seconds. What every release runs on: a Fling, a snap back to the
 * origin, and a projection node's Release offset.
 */
export const dragTransitionOf = (elastic: number | undefined, own: WardicDragTransition | undefined): ProjectionSystem.DragTransition => ({
  ...MOTION_RELEASE,
  ...Bool.match(elasticOf(elastic) !== 0, { onTrue: () => ELASTIC_BOUNCE, onFalse: () => RIGID_BOUNCE }),
  ...UndefinedOr.match(own, {
    onUndefined: () => ({}),
    onDefined: ({ timeConstant, ...rest }) => ({
      ...rest,
      ...UndefinedOr.match(timeConstant, { onUndefined: () => ({}), onDefined: (ms) => ({ timeConstant: ms / 1000 }) }),
    }),
  }),
})
