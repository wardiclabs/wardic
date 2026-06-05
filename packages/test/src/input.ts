import { InputSource } from "@wardic/core"
import type { FocusLikeEvent, PointerLikeEvent } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"

/**
 * An InputSource that replays fixed scripts of events. `pointer(target)` returns
 * the same `pointerEvents` and `focus(target)` the same `focusEvents` (both
 * ignore `target` — tests address a single surface), while `keyboard()`/`wheel()`
 * stay empty. The first positional arg is pointer events for back-compat; focus
 * events are an optional second arg, defaulting to empty so existing one-arg call
 * sites emit nothing on focus. Called with no args it yields an InputSource that
 * emits nothing — for tests that don't exercise gestures.
 */
export const layer = (
  pointerEvents: ReadonlyArray<PointerLikeEvent> = [],
  focusEvents: ReadonlyArray<FocusLikeEvent> = [],
): Layer.Layer<InputSource> =>
  Layer.succeed(InputSource, {
    pointer: () => Stream.fromIterable(pointerEvents),
    keyboard: () => Stream.empty,
    wheel: () => Stream.empty,
    focus: () => Stream.fromIterable(focusEvents),
  })

/**
 * A push-based InputSource for tests that need to interleave pointer events with
 * other effects (e.g. advancing the Clock between a fling and a re-grab). Unlike
 * {@link layer} — which replays a fixed script that drains immediately — this
 * form lets the test `push` events one at a time, on its own schedule.
 *
 * Backed by a `PubSub` (not a `Queue`) so that every call to `pointer(target)`
 * gets an **independent live subscription**: recognizers like `withMomentum`
 * subscribe to `input.pointer(target)` more than once (the drag fold and the
 * re-grab detector), and a single-consumer Queue would split events between
 * them. Broadcast delivery hands every subscriber the same events. There is no
 * replay buffer, so only events pushed *after* a subscription is live reach it —
 * `push` accordingly yields the fiber so subscribers can drain before the next.
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
  readonly layer: Layer.Layer<InputSource>
  readonly push: (event: PointerLikeEvent) => Effect.Effect<void>
  readonly pushFocus: (event: FocusLikeEvent) => Effect.Effect<void>
}> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<PointerLikeEvent>()
    const focusPubsub = yield* PubSub.unbounded<FocusLikeEvent>()
    // Yield after publishing so the merged subscribers drain this event before
    // the test pushes the next one — keeps interleaving deterministic. A single
    // yieldNow isn't enough across a merge/switchMap/fromPubSub graph; hand the
    // scheduler a small fixed budget of turns instead.
    const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })
    return {
      layer: Layer.succeed(InputSource, {
        pointer: () => Stream.fromPubSub(pubsub),
        keyboard: () => Stream.empty,
        wheel: () => Stream.empty,
        focus: () => Stream.fromPubSub(focusPubsub),
      }),
      push: (event: PointerLikeEvent) =>
        PubSub.publish(pubsub, event).pipe(Effect.flatMap(() => drain)),
      pushFocus: (event: FocusLikeEvent) =>
        PubSub.publish(focusPubsub, event).pipe(Effect.flatMap(() => drain)),
    }
  })
