/**
 * A Reorder item's input (ADR-0037), Solid-free (#379): its keys, blurs and presses told to its driver
 * by watches while a Scope is open, each inside its event, with no fiber at rest. Both bindings run it
 * in the item's watch Scope (ADR-0055, *Amendment (#379)*).
 *
 * @module
 */
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import type * as ReorderController from "@wardic/dom/ReorderController"
import * as Report from "@wardic/dom/Report"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"

/** A Primary pointer's down: a press the driver hears. */
const isPress = (event: InputSource.PointerLikeEvent): boolean => Bool.and(event.type === "down", InputSource.isPrimaryPointer(event))

/**
 * Watch an item's keys, blurs and presses for its driver (ADR-0037, #379) while the Scope is open: its
 * keys inside their dispatch, so the reorder's `handle()` (the page's `preventDefault`) counts. A blur
 * is judged after this task's own work, one scheduler hop on (#318): a reorder can blur the node it
 * moves and puts focus back after (the driver's `keepFocus`). So `fork` runs that hop on the provider
 * runtime, only when a blur happens, and a blur whose judging fails is reported. A throw from the
 * driver inside an event goes to `onDefect`.
 */
export const watchItemInput = (
  el: HTMLElement,
  driver: ReorderController.ItemDriver,
  fork: (effect: Effect.Effect<void>) => void,
  onDefect: InputFeed.OnDefect,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
  const judgeBlur = Effect.andThen(Effect.yieldNow, Effect.sync(() => driver.onBlur())).pipe(
    Effect.catchCause((cause) => Report.failure("wardic.reorder: judging an item's blur failed", cause)),
  )
  return Effect.gen(function* () {
    const input = yield* InputSource.InputSource
    yield* InputFeed.watch(input.keyboard(el), { on: (event) => driver.onKey(event), onDefect })
    yield* InputFeed.watch(input.focus(el), {
      on: (event) => {
        // The item's own blur: one inside it (#439) leaves it focused.
        if (Bool.and(event.type === "blur", event.fromTarget !== false)) fork(judgeBlur)
      },
      onDefect,
    })
    yield* InputFeed.watch(input.pointer(el), {
      on: (event) => {
        if (isPress(event)) driver.onPress()
      },
      onDefect,
    })
  })
}
