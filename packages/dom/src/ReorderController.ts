/**
 * A Reorder group on the DOM: the group, its items' drags, its keyboard and its announcements, one
 * controller a group. `make` builds one over the context's Projection system and `Announcer`, for items
 * that are layout nodes; `makePlaced` one over the `Announcer` alone, for a Batch Reorder group's items,
 * placed from their index and never measured. A binding attaches its group element, gets a driver for
 * each item, and closing the Scope ends the controller. A server render gets `inert`.
 *
 * @example
 * import * as ReorderController from "@wardic/dom/ReorderController"
 *
 * const controller = yield* ReorderController.make({ values: () => items, onReorder: (next) => (items = next) })
 * controller.attach(list)
 * const driver = controller.item(item, () => Option.some(element))
 *
 * // Items placed from their index: placed() once they're laid out in a new order.
 * const placedGroup = yield* ReorderController.makePlaced({ values: () => items, onReorder: (next) => (items = next) })
 * placedGroup.placed()
 */
// A **Reorder group**'s controller (ADR-0019 *Amendment (Reorder)*, ADR-0037); a server render's `inert`
// (ADR-0021). `@wardic/dom/ReorderController` (#132, ADR-0041). A scoped constructor, one per group (#132's
// PR 3): `make` logs its `wardic.reorder:` events through the context's Logger, and ends with its Scope,
// which stops its listening to Measure passes, resets its Auto-scroll and clears a pending announcement.
// `makePlaced` (#712, ADR-0072) is the same controller wired to its binding's placing: no projection system,
// and `placed` where `make`'s hears a Measure pass's end.
// Its items' drivers stay plain, each with its own `dispose`, since one is made per element.
import * as Announcer from "@wardic/core/Announcer"
import type * as Reorder from "@wardic/core/Reorder"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constUndefined, constVoid, identity } from "effect/Function"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Scope from "effect/Scope"
import { PassEnds } from "./internal/pass-ends.ts"
import * as internal from "./internal/reorder.ts"
import * as WardicServices from "@wardic/core/unstable/WardicServices"
import * as ProjectionSystem from "./ProjectionSystem.ts"

export {
  type ReorderEnd as End,
  type ReorderHoldEnd as HoldEnd,
  type ReorderHoldHow as HoldHow,
  type ReorderHoldStart as HoldStart,
  type ReorderItemDriver as ItemDriver,
  type ReorderItemHandle as ItemHandle,
  DEFAULT_REORDER_INSTRUCTIONS as DEFAULT_INSTRUCTIONS,
  REORDER_GROUP_STYLE as GROUP_STYLE,
  sameOrder,
} from "./internal/reorder.ts"

// The keyboard reorder's settings and attributes (ADR-0037), as every binding reads and writes them (#793, PR 3):
// solid's `reorder.tsx` and `batch-reorder.ts` had them each.

/** Whether a group's `keyboard` option turns the **Keyboard reorder** on: on unless `false`. */
export const keyboardOn = (keyboard: boolean | undefined): boolean => keyboard !== false

/** A group's instructions, the English default when it gives none. */
export const instructionsOf = (instructions: string | undefined): string =>
  UndefinedOr.match(instructions, { onUndefined: () => internal.DEFAULT_REORDER_INSTRUCTIONS, onDefined: identity })

/** An item's `aria-describedby`: the app's own ids, then the instructions', or none. */
export const describedByOf = (own: string | undefined, instructions: string | undefined): string | undefined => {
  const ids = Arr.filter([own, instructions], Predicate.isNotUndefined)
  return Bool.match(ids.length === 0, { onTrue: constUndefined, onFalse: () => ids.join(" ") })
}

/** An item's tab stop when it gives none of its own: `0` with the keyboard reorder on, or with its items pressable (a Batch Reorder group's). */
export const tabStopOf = (keyboard: boolean, pressable: boolean): 0 | undefined => Bool.match(Bool.or(keyboard, pressable), { onTrue: (): 0 => 0, onFalse: constUndefined })

/** A **Reorder group** on the DOM: what a binding attaches its group element and items to. */
export type ReorderController<V> = Omit<internal.ReorderController<V>, "dispose">

/** An item's drag axis for its gesture's axis, the group's: a grid's `"xy"` is a free drag. Built once, at module load. */
// #793 (PR 3): solid's `reorder.tsx`'s `dragAxisFor`, here for both bindings' items.
export const itemDragAxis: (axis: Reorder.Axis) => true | "x" | "y" = /*#__PURE__*/ Match.type<Reorder.Axis>().pipe(
  /*#__PURE__*/ Match.when("xy", (): true => true),
  /*#__PURE__*/ Match.orElse((axis) => axis as "x" | "y"),
)

/** What a binding hands its group: the app's values, its axis, its keyboard and its announcements. */
export type Options<V> = internal.ReorderControllerOptions<V>

/**
 * The services a controller takes from its context: the projection system its items are nodes of,
 * with what tells it each Measure pass's end (`DomProjectionSystem`'s Layer provides both), and the
 * Environment's `Announcer`.
 */
export type Services = ProjectionSystem.ProjectionSystem | PassEnds | Announcer.Announcer

/**
 * Build a group's controller over the context's projection system, announcing through its
 * `Announcer`, in the current Scope: closing it ends the controller.
 */
export const make: <V>(options: Options<V>) => Effect.Effect<ReorderController<V>, never, Services | Scope.Scope> = Effect.fnUntraced(
  function* <V>(options: Options<V>) {
    const projection = yield* ProjectionSystem.ProjectionSystem
    const passEnds = yield* PassEnds
    const announcer = yield* Announcer.Announcer
    const controller = internal.makeReorderController(
      { runtime: yield* WardicServices.makeRunner<never>(), layOut: () => projection.notify(), announce: announcer.announce, onLaidOut: passEnds.onPassEnd },
      options,
    )
    yield* Effect.addFinalizer(() => Effect.sync(controller.dispose))
    return controller
  })

/**
 * A **Batch Reorder group**'s controller, whose items are placed from their index, never measured: `placed`
 * tells it the binding has laid its items out in a new order, as a Measure pass's end tells `make`'s.
 */
// #712, ADR-0072 decision 6.
export interface Placed<V> extends ReorderController<V> {
  /** The binding has placed its items in the new order: their layout's turn, a stepped item revealed. */
  readonly placed: () => void
}

/**
 * Build a group's controller for items placed rather than measured, a Batch Reorder group's, announcing
 * through the context's `Announcer`, in the current Scope: closing it ends the controller. It needs no
 * projection system: each item registers a handle whose box is its place, raising its box's version as
 * it's placed, and the binding calls `placed` once it has placed a new order.
 */
// #712, ADR-0072 decision 6: the same controller, wired to its binding's placing.
export const makePlaced: <V>(options: Options<V>) => Effect.Effect<Placed<V>, never, Announcer.Announcer | Scope.Scope> = Effect.fnUntraced(
  function* <V>(options: Options<V>) {
    const announcer = yield* Announcer.Announcer
    // What hears the binding's placing: the controller's own, once, until it's disposed.
    let laidOut: () => void = constVoid
    const controller = internal.makeReorderController(
      {
        runtime: yield* WardicServices.makeRunner<never>(),
        // The binding places its items on a change of `values` itself.
        layOut: constVoid,
        announce: announcer.announce,
        onLaidOut: (listener) => {
          laidOut = listener
          return () => {
            laidOut = constVoid
          }
        },
      },
      options,
    )
    yield* Effect.addFinalizer(() => Effect.sync(controller.dispose))
    return { ...controller, placed: () => laidOut() }
  })

/**
 * The controller a server render gets: its group has no values, so every operation on it does nothing,
 * its axis is `"y"`, and an item's driver does nothing too.
 */
// ADR-0021.
export const inert: ReorderController<never> = internal.INERT_REORDER_CONTROLLER
