import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"

/**
 * An InputSource that replays fixed scripts of events. `pointer(target)` returns
 * the same `pointerEvents` and `focus(target)` the same `focusEvents` (both
 * ignore `target` — tests address a single surface), while `keyboard(target)`/`wheel(target)`
 * stay empty. The first positional arg is pointer events for back-compat; focus
 * events are an optional second arg, defaulting to empty so existing one-arg call
 * sites emit nothing on focus. Called with no args it yields an InputSource that
 * emits nothing — for tests that don't exercise gestures.
 */
export const layer = (
  pointerEvents: ReadonlyArray<InputSource.PointerLikeEvent> = [],
  focusEvents: ReadonlyArray<InputSource.FocusLikeEvent> = [],
): Layer.Layer<InputSource.InputSource> =>
  Layer.succeed(InputSource.InputSource, {
    pointer: () => Stream.fromIterable(pointerEvents),
    keyboard: () => Stream.empty,
    focus: () => Stream.fromIterable(focusEvents),
  })

/**
 * A push-based InputSource for tests that need to interleave pointer events with
 * other effects (e.g. advancing the Clock between a release and a re-grab). Unlike
 * {@link layer} — which replays a fixed script that drains immediately — this
 * form lets the test `push` events one at a time, on its own schedule.
 *
 * Backed by a `PubSub` (not a `Queue`) so that every call to `pointer(target)`
 * gets an **independent live subscription**: a consumer may subscribe to
 * `input.pointer(target)` more than once (a binding's drag track reads the drag
 * fold and the grabs), and a single-consumer Queue would split events between
 * them. Broadcast delivery hands every subscriber the same events. There is no
 * replay buffer, so only events pushed *after* a subscription is live reach it.
 *
 * `push` doesn't yield (ADR-0032): a subscriber waiting on the stream handles the
 * event inside the publish, as an Environment's consumers handle a real event inside
 * its dispatch, so a pipeline that hops through Effect's scheduler on its way to its
 * sink hasn't got there when `push` returns, and its test sees it.
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
 * the same schedule; `focus(target)` mirrors `pointer(target)` with its own
 * broadcast `PubSub`.
 */
export const pushable = (): Effect.Effect<{
  readonly layer: Layer.Layer<InputSource.InputSource>
  readonly push: (event: InputSource.PointerLikeEvent) => Effect.Effect<void>
  readonly pushFocus: (event: InputSource.FocusLikeEvent) => Effect.Effect<void>
}> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<InputSource.PointerLikeEvent>()
    const focusPubsub = yield* PubSub.unbounded<InputSource.FocusLikeEvent>()
    return {
      layer: Layer.succeed(InputSource.InputSource, {
        pointer: () => Stream.fromPubSub(pubsub),
        keyboard: () => Stream.empty,
        focus: () => Stream.fromPubSub(focusPubsub),
      }),
      push: (event: InputSource.PointerLikeEvent) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
      pushFocus: (event: InputSource.FocusLikeEvent) => PubSub.publish(focusPubsub, event).pipe(Effect.asVoid),
    }
  })
