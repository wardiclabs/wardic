/**
 * `makeRefreshFrameClock` — the shared, DOM-free realization of `Clock`: one
 * ref-counted Refresh frame loop over an Environment's {@link RefreshFrameSource}.
 * `@wardic/dom` passes `requestAnimationFrame`/`cancelAnimationFrame`; a native or
 * canvas Environment passes its own pair and gets the same Clock (ADR-0004: no
 * per-Environment re-implementation).
 *
 * The loop is the **single update path**: every Refresh frame computes `dt` from
 * successive timestamps and calls `tick`, which is the only writer of the
 * `time`/`dt` Atoms and the only publisher to the internal tick `PubSub`. There is
 * deliberately no `MAX_DT` clamp here — clamping is a consumer-boundary concern
 * (`fromClock`), so the Clock reports raw deltas.
 *
 * Per CONTEXT.md's **Shared source** contract, the loop is ref-counted: no
 * Refresh frame is requested while nothing is subscribed. The first subscriber to
 * `ticks` acquires the loop via an `RcRef`; concurrent subscribers share that one
 * loop; when the last subscriber's scope closes the `RcRef` releases, the
 * `forkScoped` loop fiber is interrupted, and the pending request's `cancelFrame`
 * finalizer runs.
 *
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect. It is for Environment
 * authors; `InterpolatorRegistryLive` is the precedent for a shared constructor
 * living in core.
 *
 * Observability (CONTEXT.md observability convention): each subscription to
 * `ticks` runs inside a `wardic.clock` span and emits a debug log on subscribe;
 * the per-frame `tick` path stays quiet — it is the hot path.
 */
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as RcRef from "effect/RcRef"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import type { Clock } from "./Clock.ts"

/**
 * Where an Environment's Refresh frames come from: `requestFrame` asks for one
 * callback at the next Refresh frame (passing its timestamp in ms), `cancelFrame`
 * withdraws a pending request. `requestAnimationFrame`/`cancelAnimationFrame` in
 * DOM and native. `Handle` is whatever `requestFrame` returns.
 *
 * Tier 2 (ADR-0008): for Environment authors.
 */
export interface RefreshFrameSource<Handle = unknown> {
  readonly requestFrame: (callback: (timestampMs: number) => void) => Handle
  readonly cancelFrame: (handle: Handle) => void
}

/**
 * Build a `Clock` service driven by `source`'s Refresh frames. Requires the
 * Environment's `AtomRegistry` (the registry consumers read `time`/`dt` from) and
 * a `Scope` (the loop's `RcRef` lives in it), so an Environment wraps it as
 * `Layer.effect(Clock)(makeRefreshFrameClock(source))`.
 *
 * Tier 2 (ADR-0008): Effect-typed, for Environment authors.
 */
export const makeRefreshFrameClock = <Handle>(
  source: RefreshFrameSource<Handle>,
): Effect.Effect<Context.Service.Shape<typeof Clock>, never, AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    // Called detached, never as `source.requestFrame(cb)`: a browser throws
    // "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to
    // anything but the window.
    const { requestFrame, cancelFrame } = source
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

    // Previous Refresh frame timestamp (ms), for dt computation; undefined => first frame.
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

    // One Refresh frame as an interruptible Effect: requests a frame, resumes with
    // its timestamp, and cancels the pending request on interruption.
    const nextFrame = Effect.callback<number>((resume) => {
      const handle = requestFrame((t) => resume(Effect.succeed(t)))
      return Effect.sync(() => cancelFrame(handle))
    })

    // The ref-counted Refresh frame loop: acquiring forks the per-frame loop into
    // the RcRef's scope. When the last `ticks` subscriber leaves, the RcRef
    // releases, the forked fiber is interrupted, and `nextFrame`'s finalizer
    // cancels the outstanding request — so no Refresh frame is requested with zero
    // subscribers.
    //
    // Reset `lastTime` on every acquire (the 0 -> 1 ref-count transition). The
    // closure variable outlives the forked loop, so without this a subscriber that
    // arrives after an idle gap would compute its first dt against the STALE last
    // timestamp — a huge spurious delta that lurches every spring forward a frame.
    // Resetting makes the first frame after a (re)subscribe a clean dt = 0, exactly
    // like the first-ever frame.
    const loopRef = yield* RcRef.make({
      acquire: Effect.sync(() => {
        lastTime = undefined
      }).pipe(Effect.andThen(Effect.forkScoped(Effect.forever(Effect.flatMap(nextFrame, tick))).pipe(Effect.asVoid))),
    })

    // Subscribing acquires the (shared, ref-counted) Refresh frame loop, then
    // reads dt from the tick PubSub.
    const ticks = Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.logDebug("wardic.clock: subscribe")
        yield* RcRef.get(loopRef)
        return Stream.fromPubSub(tickPubSub)
      }),
    ).pipe(Stream.withSpan("wardic.clock"))

    return { time, dt, ticks, tick }
  })
