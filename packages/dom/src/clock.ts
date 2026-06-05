/**
 * `ClockDomLive` — the browser realization of `Clock`, driven by
 * `requestAnimationFrame`.
 *
 * The rAF loop is the **single update path**: every frame computes `dt` from
 * successive timestamps and calls {@link tick}, which is the only writer of the
 * `time`/`dt` Atoms and the only publisher to the internal tick `PubSub`. There
 * is deliberately no `MAX_DT` clamp here — clamping is a consumer-boundary
 * concern (`fromClock` in core), so the Clock reports raw deltas.
 *
 * Per CONTEXT.md's **Shared source** contract, the loop is ref-counted: no
 * `requestAnimationFrame` is scheduled while nothing is subscribed. The first
 * subscriber to `ticks` acquires the rAF driver via an `RcRef`; concurrent
 * subscribers share that one loop; when the last subscriber's scope closes the
 * `RcRef` releases, the `forkScoped` pump fiber is interrupted, and the pending
 * frame's `cancelAnimationFrame` finalizer runs.
 *
 * Observability (CONTEXT.md observability convention): the `make`/driver carries
 * a `wardic.clock` span + a debug-log on subscribe; the per-frame `tick` path
 * stays quiet — it is the hot path.
 */
import { Clock } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as RcRef from "effect/RcRef"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"

/**
 * Captures the Environment's {@link AtomRegistry} at build time and closes over
 * it in `tick`, so the hot per-frame writes go through the same registry a
 * consumer reads `Clock.time`/`Clock.dt` from — without leaking an
 * `AtomRegistry` requirement into `Clock.tick`'s `Effect<void>` signature.
 */
const make = Effect.gen(function* () {
  // The shared Environment registry — the one consumers read these atoms from.
  const registry = yield* AtomRegistry.AtomRegistry
  // Mirror TestClock's Atom shape exactly (writable state atoms from a plain
  // value). `keepAlive` pins each node in the registry so the value `tick`
  // writes survives between frames: an idle node with no mounted subscriber is
  // garbage-collected, and the next read would re-initialize it to 0.
  const time = Atom.keepAlive(Atom.make(0))
  const dt = Atom.keepAlive(Atom.make(0))

  // Carries dt (seconds) to subscribers of `ticks`.
  const tickPubSub = yield* PubSub.unbounded<number>()

  // Previous absolute timestamp (ms), for dt computation; undefined => first frame.
  let lastTime: number | undefined

  /**
   * THE SINGLE UPDATE PATH. dt = first-frame ? 0 : (t - lastTime) / 1000.
   * Writes the `time`/`dt` Atoms and publishes dt to the tick PubSub. No clamp.
   * Hot path — intentionally unlogged.
   */
  const tick = (t: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const delta = lastTime === undefined ? 0 : (t - lastTime) / 1000
      lastTime = t
      registry.set(time, t)
      registry.set(dt, delta)
      return PubSub.publish(tickPubSub, delta).pipe(Effect.asVoid)
    })

  // One animation frame as an interruptible Effect: schedules an rAF, resumes
  // with the high-res timestamp, and cancels the pending frame on interruption.
  const nextFrame = Effect.callback<number>((resume) => {
    const id = requestAnimationFrame((t) => resume(Effect.succeed(t)))
    return Effect.sync(() => cancelAnimationFrame(id))
  })

  // Ref-counted rAF driver: acquiring forks the per-frame loop into the RcRef's
  // scope. When the last `ticks` subscriber leaves, the RcRef releases, the
  // forked fiber is interrupted, and `nextFrame`'s finalizer cancels the
  // outstanding frame — so no rAF runs with zero subscribers.
  //
  // Reset `lastTime` on every acquire (the 0 -> 1 ref-count transition). The
  // closure variable outlives the forked loop, so without this a subscriber that
  // arrives after an idle gap would compute its first dt against the STALE last
  // timestamp — a huge spurious delta that lurches every spring forward a frame.
  // Resetting makes the first frame after a (re)subscribe a clean dt = 0, exactly
  // like the first-ever frame.
  const rafRef = yield* RcRef.make({
    acquire: Effect.sync(() => {
      lastTime = undefined
    }).pipe(Effect.andThen(Effect.forkScoped(Effect.forever(Effect.flatMap(nextFrame, tick))).pipe(Effect.asVoid))),
  })

  // Subscribing acquires the (shared, ref-counted) rAF driver, then reads dt
  // from the tick PubSub.
  const ticks = Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.clock: subscribe")
      yield* RcRef.get(rafRef)
      return Stream.fromPubSub(tickPubSub)
    }),
  ).pipe(Stream.withSpan("wardic.clock"))

  return { time, dt, ticks, tick }
})

/**
 * `Clock` Layer backed by a `requestAnimationFrame` loop. Requires the
 * Environment's `AtomRegistry` (the registry consumers read `time`/`dt` from);
 * `DomLive` provides it via `AtomRegistry.layer`, exactly as `testLayer` does.
 */
export const ClockDomLive: Layer.Layer<Clock, never, AtomRegistry.AtomRegistry> = Layer.effect(
  Clock,
)(make)
