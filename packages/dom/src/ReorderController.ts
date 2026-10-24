/**
 * A **Reorder group**'s controller in the DOM: the group, its drag, its keyboard and its announcements (ADR-0019 *Amendment (Reorder)*, ADR-0037). A server render gets `inert` (ADR-0021).
 *
 * `@wardic/dom/ReorderController` (#132, ADR-0041).
 *
 * It's built by a scoped constructor, one per group (#132's PR 3): `make` takes the projection system
 * and the `Announcer` from its context, logs its `wardic.reorder:` events through the context's
 * Logger, and ends with its Scope, which stops its listening to Measure passes, resets its
 * Auto-scroll and clears a pending announcement. Its items' drivers stay plain, each with its own
 * `dispose`, since one is made per element.
 */
import * as Announcer from "@wardic/core/Announcer"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as internal from "./internal/reorder.ts"
import { makeRunner } from "./internal/runner.ts"
import * as ProjectionSystem from "./ProjectionSystem.ts"

export {
  type ReorderEnd as End,
  type ReorderHoldEnd as HoldEnd,
  type ReorderHoldHow as HoldHow,
  type ReorderHoldStart as HoldStart,
  type ReorderItemDriver as ItemDriver,
  DEFAULT_REORDER_INSTRUCTIONS as DEFAULT_INSTRUCTIONS,
  REORDER_GROUP_STYLE as GROUP_STYLE,
} from "./internal/reorder.ts"

/** A **Reorder group** on the DOM: what a binding attaches its group element and items to. */
export type ReorderController<V> = Omit<internal.ReorderController<V>, "dispose">

/** What a binding hands its group: the app's values, its axis, its keyboard and its announcements. */
export type Options<V> = internal.ReorderControllerOptions<V>

/** The services a controller takes from its context. */
export type Services = ProjectionSystem.ProjectionSystem | Announcer.Announcer

/**
 * Build a group's controller over the context's projection system, announcing through its
 * `Announcer`, in the current Scope: closing it ends the controller.
 */
export const make = <V>(options: Options<V>): Effect.Effect<ReorderController<V>, never, Services | Scope.Scope> =>
  Effect.gen(function* () {
    const projection = yield* ProjectionSystem.ProjectionSystem
    const announcer = yield* Announcer.Announcer
    const controller = internal.makeReorderController(
      { runtime: yield* makeRunner<never>(), projection, announce: announcer.announce },
      options,
    )
    yield* Effect.addFinalizer(() => Effect.sync(controller.dispose))
    return controller
  })

/**
 * The controller a server render gets (ADR-0021): its group has no values, so every operation on
 * it does nothing, the axis is `"y"`, and an item's driver is inert too.
 */
export const inert: ReorderController<never> = internal.INERT_REORDER_CONTROLLER
