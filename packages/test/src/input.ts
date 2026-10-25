import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Feeds from "./feeds.ts"

/**
 * An InputSource that replays fixed scripts of events, as **Input feeds** that end after their
 * script (#318: a Stream over one ends too). `pointer(target)` replays the same `pointerEvents`
 * and `focus(target)` the same `focusEvents` to each subscriber (both ignore `target` — tests
 * address a single surface), while `keyboard(target)` ends at once. The first positional arg is pointer events for back-compat; focus
 * events are an optional second arg, defaulting to empty so existing one-arg call
 * sites emit nothing on focus. Called with no args it yields an InputSource that
 * emits nothing — for tests that don't exercise gestures.
 */
export const layer = (
  pointerEvents: ReadonlyArray<InputSource.PointerLikeEvent> = [],
  focusEvents: ReadonlyArray<InputSource.FocusLikeEvent> = [],
): Layer.Layer<InputSource.InputSource> =>
  Layer.succeed(InputSource.InputSource, {
    pointer: () => Feeds.script(pointerEvents),
    keyboard: () => Feeds.script([]),
    focus: () => Feeds.script(focusEvents),
  })

/**
 * A push-based InputSource for tests that need to interleave pointer events with
 * other effects (e.g. advancing the Clock between a release and a re-grab). Unlike
 * {@link layer} — which replays a fixed script that drains immediately — this
 * form lets the test `push` events one at a time, on its own schedule.
 *
 * Backed by a hub (`feeds.ts`, #318) so that every subscription to `pointer(target)`
 * hears every event: a consumer may subscribe to `input.pointer(target)` more than once
 * (a binding's drag track reads the drag fold and the grabs). There is no replay buffer,
 * so only events pushed *after* a subscription is live reach it.
 *
 * `push` doesn't yield (ADR-0032): a subscriber handles the event inside the push, as an
 * Environment's consumers handle a real event inside its dispatch, so a pipeline that hops
 * through Effect's scheduler on its way to its sink hasn't got there when `push` returns,
 * and its test sees it.
 *
 * Returns `{ layer, push }`. Resolve it inside an `Effect.gen`, provide `layer`,
 * and drive the surface with `push`:
 *
 * @example
 * const input = yield* TestInput.pushable()
 * yield* Stream.runForEach(drag(undefined), …).pipe(Effect.fork…)  // subscribe
 * yield* input.push(ev("down", 0, 0, 0))
 *
 * Returns `pushFocus` alongside `push` so focus/blur transitions can be driven on
 * the same schedule; `focus(target)` mirrors `pointer(target)` with its own hub.
 */
export const pushable = (): Effect.Effect<{
  readonly layer: Layer.Layer<InputSource.InputSource>
  readonly push: (event: InputSource.PointerLikeEvent) => Effect.Effect<void>
  readonly pushFocus: (event: InputSource.FocusLikeEvent) => Effect.Effect<void>
}> =>
  Effect.sync(() => {
    const pointer = Feeds.hub<InputSource.PointerLikeEvent>()
    const focus = Feeds.hub<InputSource.FocusLikeEvent>()
    return {
      layer: Layer.succeed(InputSource.InputSource, {
        pointer: () => pointer.feed,
        keyboard: () => Feeds.script([]),
        focus: () => focus.feed,
      }),
      push: pointer.push,
      pushFocus: focus.push,
    }
  })
