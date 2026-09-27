/**
 * `makeRefreshFrameClock` — the shared, DOM-free realization of `Clock`: one
 * ref-counted Refresh frame loop over an Environment's {@link RefreshFrameSource}.
 * `@wardic/dom` passes `requestAnimationFrame`/`cancelAnimationFrame`; a native or
 * canvas Environment passes its own pair and gets the same Clock (ADR-0004: no
 * per-Environment re-implementation).
 *
 * The loop is the **single update path**: every Refresh frame computes `dt` from
 * successive timestamps and calls `tick`, which (with the Priming tick below) is the
 * only writer of the `time`/`dt` Atoms and the only publisher to the internal tick
 * `PubSub`. There is deliberately no `MAX_DT` clamp here — clamping is a
 * consumer-boundary concern (`fromClock`), so the Clock reports raw deltas.
 *
 * **Cold start** (ADR-0017): the subscription that starts an idle loop gets a
 * **Priming tick** at the end of its task, with `dt = NOMINAL_DT`, before the first
 * Refresh frame. A start made inside a Refresh frame (a layout animation begins in
 * the gate's measure pass) therefore writes its first moved value in that same
 * frame, and the gate paints it in the next one — exactly like a warm start, whose
 * tick in that frame is already queued. `dt` stays nominal until two Refresh frame
 * timestamps exist (the first Refresh frame has nothing to measure against), then
 * it is the measured interval. The loop never goes through the Effect scheduler:
 * it starts synchronously, reaches the Priming tick via `nextMicrotask`, and
 * requests each next Refresh frame inside the current one's callback, after the
 * tick is delivered — so timing is the same in browsers (scheduler =
 * `setTimeout(0)`), React Native and the test harness (scheduler = microtask).
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
import { NOMINAL_DT } from "../primitives/frame.ts"
import { nextMicrotask } from "../util/microtask.ts"
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

    // Previous Refresh frame timestamp (ms), for dt computation; undefined => no
    // Refresh frame since the loop started. Only Refresh frame timestamps set it —
    // the Priming tick has none (ADR-0017, decision 2).
    let lastTime: number | undefined

    /**
     * THE SINGLE UPDATE PATH. dt = no earlier Refresh frame ? NOMINAL_DT : (t - lastTime) / 1000.
     * Writes the `time`/`dt` Atoms and publishes dt to the tick PubSub. No clamp.
     * Hot path — intentionally unlogged.
     */
    const tick = (t: number): Effect.Effect<void> =>
      Effect.suspend(() => {
        const delta = lastTime === undefined ? NOMINAL_DT : (t - lastTime) / 1000
        lastTime = t
        registry.set(time, t)
        registry.set(dt, delta)
        return PubSub.publish(tickPubSub, delta).pipe(Effect.asVoid)
      })

    // The Priming tick: the nominal dt, published to whoever subscribed in the task
    // that started the loop. It has no Refresh frame timestamp, so it leaves `time`
    // and `lastTime` alone. Once per Cold start — not the hot path.
    const primingTick: Effect.Effect<void> = Effect.suspend(() => {
      registry.set(dt, NOMINAL_DT)
      return PubSub.publish(tickPubSub, NOMINAL_DT).pipe(Effect.asVoid)
    })

    // One Refresh frame as an interruptible Effect: requests a frame, resumes with
    // its timestamp, and cancels the pending request on interruption.
    const nextFrame = Effect.callback<number>((resume) => {
      const handle = requestFrame((t) => resume(Effect.succeed(t)))
      return Effect.sync(() => cancelFrame(handle))
    })

    // The loop body, entirely off the Effect scheduler (ADR-0017, decision 3):
    // `nextMicrotask` resumes inside its microtask, `nextFrame` inside the Refresh
    // frame callback, and `disableYield` drops `forever`'s per-iteration `yieldNow`
    // — which would otherwise request every next Refresh frame from a scheduler task
    // (a `setTimeout(0)` after paint, in a browser). Each iteration waits on a
    // Refresh frame, so it never spins.
    const loop = nextMicrotask.pipe(
      Effect.andThen(primingTick),
      Effect.andThen(Effect.forever(Effect.flatMap(nextFrame, tick), { disableYield: true })),
    )

    // The ref-counted Refresh frame loop: acquiring forks the loop into the RcRef's
    // scope. When the last `ticks` subscriber leaves, the RcRef releases, the forked
    // fiber is interrupted, and the pending wait's finalizer cancels it (an
    // outstanding Refresh frame request is cancelled; a pending Priming tick never
    // fires) — so nothing runs with zero subscribers. `startImmediately` runs the
    // fork synchronously up to `nextMicrotask`, rather than posting it to the
    // scheduler.
    //
    // Reset `lastTime` on every acquire (the 0 -> 1 ref-count transition). The
    // closure variable outlives the forked loop, so without this a subscriber that
    // arrives after an idle gap would compute its first dt against the STALE last
    // timestamp — a huge spurious delta that lurches every spring forward a frame.
    // Resetting makes every Cold start begin like the first-ever one.
    const loopRef = yield* RcRef.make({
      acquire: Effect.sync(() => {
        lastTime = undefined
      }).pipe(Effect.andThen(Effect.forkScoped(loop, { startImmediately: true })), Effect.asVoid),
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
