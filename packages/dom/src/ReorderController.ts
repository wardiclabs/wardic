/**
 * A Reorder group on the DOM: the group, its items' drags, its keyboard and its announcements, one
 * controller a group. `make` builds one over the context's Projection system and `Announcer`; a binding
 * attaches its group element, gets a driver for each item, and closing the Scope ends the controller. A
 * server render gets `inert`.
 *
 * @example
 * import * as ReorderController from "@wardic/dom/ReorderController"
 *
 * const controller = yield* ReorderController.make({ values: () => items, onReorder: (next) => (items = next) })
 * controller.attach(list)
 * const driver = controller.item(item, () => Option.some(element))
 */
// A **Reorder group**'s controller (ADR-0019 *Amendment (Reorder)*, ADR-0037); a server render's `inert`
// (ADR-0021). `@wardic/dom/ReorderController` (#132, ADR-0041). A scoped constructor, one per group (#132's
// PR 3): `make` logs its `wardic.reorder:` events through the context's Logger, and ends with its Scope,
// which stops its listening to Measure passes, resets its Auto-scroll and clears a pending announcement.
// Its items' drivers stay plain, each with its own `dispose`, since one is made per element.
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
export const make: <V>(options: Options<V>) => Effect.Effect<ReorderController<V>, never, Services | Scope.Scope> = Effect.fnUntraced(
  function* <V>(options: Options<V>) {
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
 * The controller a server render gets: its group has no values, so every operation on it does nothing,
 * its axis is `"y"`, and an item's driver does nothing too.
 */
// ADR-0021.
export const inert: ReorderController<never> = internal.INERT_REORDER_CONTROLLER
