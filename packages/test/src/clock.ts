import * as Clock from "@wardic/core/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"

/**
 * A deterministic Clock for frame-level tests. `ticks` replays the supplied `dt`
 * sequence (in seconds) exactly once, so a primitive's per-frame output can be
 * collected with `Stream.runCollect` and asserted. A live Clock (rAF-driven) is
 * `@wardic/dom`'s.
 */
export const makeTestClock = (frames: ReadonlyArray<number> = []) => ({
  ticks: Stream.fromIterable(frames),
  tick: (_t: number) => Effect.sync(() => {}),
})

/** Clock Layer that emits `frames` (dt values, seconds) then completes. */
export const layer = (frames: ReadonlyArray<number> = []): Layer.Layer<Clock.Clock> =>
  Layer.succeed(Clock.Clock, makeTestClock(frames))

/**
 * Convenience: `n` frames of a fixed `dt` (default 1/60s) — e.g. `frames(30)`
 * for half a second at 60fps.
 */
export const frames = (count: number, dt = 1 / 60): ReadonlyArray<number> =>
  Array.from({ length: count }, () => dt)

/**
 * Cooperatively hand the scheduler enough turns for a forked consumer fiber to
 * pull a freshly-published PubSub item all the way through its Stream pipeline
 * (subscription buffer -> chunk -> downstream emit) before the test proceeds.
 * One `yieldNow` is not enough across a `merge`/`switchMap`/`fromPubSub` graph;
 * a small fixed budget makes the interleaving deterministic without real time.
 */
const flush = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, {
  discard: true,
})

/**
 * A push-based Clock for tests that need to advance frames *on demand* —
 * interleaved with pointer input — rather than replaying a fixed sequence. The
 * static {@link layer} drains its whole `ticks` stream as fast as the consumer
 * pulls, which makes it impossible to assert "advance a few frames, do
 * something, advance more". This form lets the test `advance` one dt at a time.
 *
 * Backed by a `PubSub` (broadcast, no replay) so a consumer only sees ticks
 * pushed *after* it subscribes — matching a live rAF clock where motion starts
 * from the moment you subscribe. `advance` yields the fiber after publishing so
 * the subscribing stream processes the frame before the next `advance`.
 *
 * @example
 * const clock = yield* TestClock.pushable()
 * // … fork a stream that consumes Clock.ticks, providing clock.layer …
 * yield* clock.advance()        // one 1/60s frame
 * yield* clock.advance(1 / 30)  // a custom dt
 */
export const pushable = (): Effect.Effect<{
  readonly layer: Layer.Layer<Clock.Clock>
  readonly advance: (dt?: number) => Effect.Effect<void>
}> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<number>()
    return {
      layer: Layer.succeed(Clock.Clock, {
        ticks: Stream.fromPubSub(pubsub),
        tick: (_t: number) => Effect.sync(() => {}),
      }),
      advance: (dt = 1 / 60) =>
        PubSub.publish(pubsub, dt).pipe(Effect.flatMap(() => flush)),
    }
  })
