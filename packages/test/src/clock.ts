import * as Clock from "@wardic/core/Clock"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Predicate from "effect/Predicate"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"

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
 * The Refresh frames `pushable`'s `advance` fires: a `RefreshFrameSource` that keeps the
 * contract's order rules, as `requestAnimationFrame` does (ADR-0031, decision 4). `fire` runs the
 * callbacks requested before it, in request order. One requested while they run waits for the
 * next `fire`, and one cancelled before its turn never runs.
 */
const makeFrames = () => {
  const pending = new Map<number, (timestampMs: number) => void>()
  const nextHandle = MutableRef.make(1)
  const source: RefreshFrameSource.Shape = {
    requestFrame: (callback) => {
      const handle = MutableRef.getAndIncrement(nextHandle)
      pending.set(handle, callback)
      return handle
    },
    cancelFrame: (handle) => {
      if (Predicate.isNumber(handle)) pending.delete(handle)
    },
  }
  /** Run the callbacks requested so far at timestamp `t` (ms). */
  const fire = (t: number): void =>
    Arr.forEach(Arr.fromIterable(pending.keys()), (handle) =>
      UndefinedOr.match(pending.get(handle), {
        onUndefined: constVoid,
        onDefined: (callback) => {
          pending.delete(handle)
          callback(t)
        },
      }))
  return { source, fire }
}

/**
 * A push-based Clock for tests that need to advance frames *on demand* —
 * interleaved with pointer input — rather than replaying a fixed sequence. The
 * static {@link layer} drains its whole `ticks` stream as fast as the consumer
 * pulls, which makes it impossible to assert "advance a few frames, do
 * something, advance more". This form lets the test `advance` one dt at a time.
 *
 * Backed by a `PubSub` (broadcast, no replay) so a consumer only sees ticks
 * pushed *after* it subscribes — matching a live rAF clock where motion starts
 * from the moment you subscribe. It has no Cold start, so no Priming tick.
 *
 * Its `layer` also provides the Environment's `RefreshFrameSource` (ADR-0031), and one `advance`
 * is one Refresh frame in the web's order: it runs the frames requested so far (a flush gate's
 * flush), in request order, then publishes `dt` (the Clock's tick). A frame requested during
 * that `advance` waits for the next one. The frames' timestamps start at 0 and advance by `dt`.
 *
 * It doesn't yield (ADR-0032): a subscriber waiting on the ticks handles the tick inside the
 * publish, as every subscriber does inside a real Refresh frame's callback, so a consumer that
 * hops through Effect's scheduler on its way to its sink hasn't got there when `advance`
 * returns, and its test sees it.
 *
 * @example
 * const clock = yield* TestClock.pushable()
 * // … fork a stream that consumes Clock.ticks, providing clock.layer …
 * yield* clock.advance()        // one 1/60s frame
 * yield* clock.advance(1 / 30)  // a custom dt
 */
export const pushable = (): Effect.Effect<{
  readonly layer: Layer.Layer<Clock.Clock | RefreshFrameSource.RefreshFrameSource>
  readonly advance: (dt?: number) => Effect.Effect<void>
}> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<number>()
    const frames = makeFrames()
    const time = MutableRef.make(0)
    return {
      layer: Layer.merge(
        Layer.succeed(Clock.Clock, {
          ticks: Stream.fromPubSub(pubsub),
          tick: (_t: number) => Effect.sync(() => {}),
        }),
        RefreshFrameSource.layer(frames.source),
      ),
      advance: (dt = 1 / 60) =>
        Effect.sync(() => frames.fire(MutableRef.updateAndGet(time, (t) => t + dt * 1000))).pipe(
          Effect.andThen(PubSub.publish(pubsub, dt)),
          Effect.asVoid,
        ),
    }
  })
