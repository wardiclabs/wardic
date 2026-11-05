/**
 * The Clock: the engine's time. Its `ticks` give the seconds since the frame before, once a frame, which
 * every running animation counts, and `now` the Environment's time, the same for the rest of a
 * synchronous block. An Environment builds it with `layer`, over its `RefreshFrameSource`, so every
 * Environment's Clock runs the same loop: it starts at its first subscription, ticks once a frame, and
 * stops at the first frame that finds no one subscribed.
 *
 * @example
 * import * as Clock from "@wardic/core/Clock"
 *
 * const clock = yield* Clock.Clock
 * yield* clock.ticks.pipe(Stream.take(3), Stream.runForEach((dt) => Effect.log(dt)))
 */
// `fromRefreshFrames` is the shared, DOM-free realization every Environment builds its Clock from: one
// shared Refresh frame loop over an Environment's `RefreshFrameSource` (ADR-0031); ADR-0004: no
// per-Environment re-implementation.
//
// The loop is the single update path: every Refresh frame computes `dt` from successive timestamps and
// calls `tick`, the only publisher to the internal tick `PubSub`. There is deliberately no `MAX_DT` clamp
// here: clamping is a consumer-boundary concern (each leaf's step clamps at `Machine.MAX_DT`, #78), so the
// Clock reports raw deltas.
//
// Cold start (ADR-0017, ADR-0033): the subscription that starts an idle loop gets its first tick at the
// next Refresh frame, as a warm start does, with `dt = NOMINAL_DT`: `dt` stays nominal until two Refresh
// frame timestamps exist, then it is the measured interval. The flush gate paints what a tick writes at
// the end of the Frame loop's tick, in that Refresh frame, so a Cold start's first step paints in the
// first Refresh frame. (Until #73 the gate painted a frame later, and a Priming tick at the end of the
// subscribing task made up for it.) The loop never goes through the Effect scheduler: it starts
// synchronously, waits for the end of its task via `Microtask.next` (so a subscription made and dropped
// in one task requests no Refresh frame), and requests each next Refresh frame inside the current one's
// callback, after the tick is delivered, so timing is the same in browsers (scheduler = `setTimeout(0)`),
// React Native and the test harness (scheduler = microtask).
//
// Per CONTEXT.md's **Shared source** contract, the loop is shared and counted. It stops the way Motion's
// frame loop does (ADR-0017, decision 9): the last subscriber leaving does not stop it; the first Refresh
// frame that finds no subscriber ends it without ticking or requesting another. A subscriber that arrives
// before that frame (the new animation of a retarget, which `createWard` starts right after interrupting
// the old one) joins warm, with a measured dt.
//
// Tier 2 (ADR-0008): Effect-typed, stability tracks Effect, for Environment authors;
// `InterpolatorRegistry.layer` is the precedent for a shared constructor living in core. Observability:
// each subscription to `ticks` runs inside a `wardic.clock` span and emits a debug log on subscribe; the
// per-frame `tick` path stays quiet, the hot path.
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as PubSub from "effect/PubSub"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Microtask from "./Microtask.ts"
import * as RefreshFrameSource from "./RefreshFrameSource.ts"
import { tracedStream } from "./internal/tracing.ts"

/**
 * The engine's time: each frame's seconds, and the Environment's time now. A subscription that starts an
 * idle Clock gets its first tick at the next frame, with `NOMINAL_DT`, and a measured interval from the
 * second frame on. The Clock goes idle only at the first frame that finds no subscriber, so an animation
 * replaced by another in the same task keeps it ticking.
 */
// Frame time (CONTEXT.md) is what Primitives count of it; Environments drive it by calling `tick`. The
// Cold start contract (ADR-0017, ADR-0033), which `fromRefreshFrames` implements: no tick depends on the
// Effect scheduler, and an unsubscribe followed by a subscribe before the next frame (a retarget) is a
// warm start.
export class Clock extends Context.Service<Clock, {
  /** The seconds since the frame before, one per frame: what animations count. */
  readonly ticks: Stream.Stream<number>
  /** Advances the Clock to time `t`: what an Environment that drives its own Clock calls. */
  readonly tick: (t: number) => Effect.Effect<void>
  /**
   * The Environment's time now, in ms, the same for the rest of a synchronous block, as Motion's
   * `sync-time`: what a key's velocity is read against, so a test Environment's Clock drives velocities
   * too.
   */
  // #464; #460, Q7.
  readonly now: () => number
}>()("@wardic/Clock") {}

/**
 * The seconds a Clock ticks while it has no measured interval yet, at its first frame: one frame at
 * 60 Hz, as Motion's first frame after its loop wakes.
 */
// A Cold start (ADR-0017). Motion's first-frame `delta = 1000 / 60` (motion-dom `frameloop/batcher.ts:47-49`
// @16c6122).
export const NOMINAL_DT = 1 / 60

// @wardic/core compiles against ES2022 alone (no DOM lib, no Node types), which does
// not declare `performance` or `queueMicrotask`. They are host globals in every environment
// Wardic targets (browsers, Node, React Native), so they are declared here, in module scope only.
declare const performance: { readonly now: () => number }
declare const queueMicrotask: (callback: () => void) => void

/**
 * `read`, read once a synchronous block: the first call reads it and keeps it until the end of the task,
 * so every sink a tick runs, and an animation replaced in the same task, read one time, as Motion's
 * `sync-time`. A Clock's `now` for an Environment whose time is a wall clock.
 *
 * @example
 * const now = Clock.syncNow(() => performance.now())
 */
// #464: cleared by a microtask.
export const syncNow = (read: () => number): (() => number) => {
  let kept: number | undefined
  const clear = (): void => {
    kept = undefined
  }
  return () => {
    if (Predicate.isNotUndefined(kept)) return kept
    const at = read()
    kept = at
    queueMicrotask(clear)
    return at
  }
}

/**
 * A Clock driven by `source`'s frames, its loop running in the Scope, and its frame asked for cancelled
 * when the Scope closes. An Environment provides its source as a member and builds its Clock with
 * `layer`; this is for a source that isn't in the Environment.
 */
// Tier 2 (ADR-0008): Effect-typed, for Environment authors.
export const fromRefreshFrames: <Handle>(
  source: RefreshFrameSource.Shape<Handle>,
) => Effect.Effect<Context.Service.Shape<typeof Clock>, never, Scope.Scope> = Effect.fnUntraced(
  function* <Handle>(source: RefreshFrameSource.Shape<Handle>) {
    // Called detached, never as `source.requestFrame(cb)`: a browser throws
    // "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to
    // anything but the window.
    const { requestFrame, cancelFrame } = source
    const now = Option.getOrElse(Option.fromNullishOr(source.now), () => () => performance.now())

    // Carries dt (seconds) to subscribers of `ticks`.
    const tickPubSub = yield* PubSub.unbounded<number>()

    // The previous Refresh frame's time (ms), for dt computation; None => no
    // Refresh frame since the loop started (ADR-0017, decision 2). It is the frame's
    // timestamp, except for a frame that repeats the previous timestamp (below).
    const lastTime = MutableRef.make(Option.none<number>())
    // The previous Refresh frame's raw timestamp, and `now()` when it was delivered.
    const lastStamp = MutableRef.make(Option.none<number>())
    const lastNow = MutableRef.make(0)

    /**
     * A Refresh frame's time and dt, from its timestamp `t` and `now()` at its delivery: see
     * `tick`. `[t, NOMINAL_DT]` with no earlier Refresh frame.
     */
    const timing = (t: number, at: number): readonly [current: number, delta: number] =>
      Option.match(MutableRef.get(lastTime), {
        onNone: () => [t, NOMINAL_DT] as const,
        onSome: (last) =>
          Bool.match(
            Option.exists(MutableRef.get(lastStamp), (stamp) => stamp === t),
            {
              onTrue: () => {
                const current = last + (at - MutableRef.get(lastNow))
                return [current, (current - last) / 1000] as const
              },
              onFalse: () => [t, Math.max(0, (t - last) / 1000)] as const,
            },
          ),
      })

    /**
     * THE SINGLE UPDATE PATH. dt is NOMINAL_DT with no earlier Refresh frame, else (t - lastTime) / 1000.
     *
     * A Refresh frame whose timestamp REPEATS the previous one is timed by the
     * elapsed `now()` since the previous frame instead: Firefox runs a second frame
     * right after an input and passes it the previous frame's timestamp, which would
     * otherwise advance nothing (#18; ADR-0017, amended by #2). The next frame then
     * gets the rest of the interval, and a dt never goes below 0. There is no upper
     * clamp here: that is the consumer boundary's (`MAX_DT`).
     *
     * Publishes dt to the tick PubSub. Hot path — intentionally unlogged; one `now()`
     * read per Refresh frame.
     */
    const tick = (t: number): Effect.Effect<void> =>
      Effect.suspend(() => {
        const at = now()
        const [current, delta] = timing(t, at)
        MutableRef.set(lastTime, Option.some(current))
        MutableRef.set(lastStamp, Option.some(t))
        MutableRef.set(lastNow, at)
        return PubSub.publish(tickPubSub, delta).pipe(Effect.asVoid)
      })

    // One Refresh frame as an interruptible Effect: requests a frame, resumes with
    // its timestamp, and cancels the pending request on interruption.
    const nextFrame = Effect.callback<number>((resume) => {
      const handle = requestFrame((t) => resume(Effect.succeed(t)))
      return Effect.sync(() => cancelFrame(handle))
    })

    // Open `ticks` subscriptions, and whether the loop is running (false = idle).
    const subscribers = MutableRef.make(0)
    const running = MutableRef.make(false)

    // One Refresh frame: tick if anyone is still subscribed, and say whether the
    // loop goes on. The first Refresh frame that finds no subscriber ends the loop
    // without ticking or requesting another (ADR-0017, decision 9), so an
    // unsubscribe followed by a subscribe before it keeps the loop warm.
    const frame: Effect.Effect<boolean> = Effect.flatMap(nextFrame, (t) =>
      Bool.match(MutableRef.get(subscribers) === 0, { onTrue: () => Effect.succeed(false), onFalse: () => Effect.as(tick(t), true) }),
    )

    // The loop, entirely off the Effect scheduler (ADR-0017, decision 3):
    // `Microtask.next` resumes inside its microtask, `nextFrame` inside the Refresh
    // frame callback, and `whileLoop` never yields — so each next Refresh frame is
    // requested inside the current one's callback, after the tick is delivered,
    // rather than from a scheduler task (a `setTimeout(0)` after paint, in a
    // browser). Each iteration waits on a Refresh frame, so it never spins.
    const loop = Effect.suspend(() => {
      let live = true
      return Microtask.next.pipe(
        // Everyone left in the task that started the loop: end here, with no Refresh
        // frame requested. Otherwise the first tick is the next Refresh frame's
        // (ADR-0033: no Priming tick).
        Effect.andThen(
          Effect.sync(() => {
            live = MutableRef.get(subscribers) > 0
          }),
        ),
        Effect.andThen(
          Effect.whileLoop({
            while: () => live,
            body: () => frame,
            step: (goOn) => {
              live = goOn
            },
          }),
        ),
      )
    }).pipe(
      Effect.ensuring(Effect.sync(() => MutableRef.set(running, false))),
    )

    // The loop runs in the Clock Layer's scope, forked under the Layer's build
    // context — never a subscriber's, so it inherits no subscriber's scheduler or
    // op budget — and the scope closing interrupts it, cancelling its pending
    // request. `startImmediately` runs the fork synchronously up to
    // `Microtask.next`, rather than posting it to the scheduler.
    //
    // Reset `lastTime` on every start. The closure variable outlives the loop, so
    // without this a subscriber that arrives after an idle gap would compute its
    // first dt against the STALE last timestamp — a huge spurious delta that lurches
    // every spring forward a frame. Resetting makes every Cold start begin like the
    // first-ever one.
    const scope = yield* Scope.Scope
    const buildContext = yield* Effect.context<Scope.Scope>()
    const start: Effect.Effect<void> = Effect.suspend(() => {
      MutableRef.set(running, true)
      MutableRef.set(lastTime, Option.none())
      MutableRef.set(lastStamp, Option.none())
      return Effect.forkIn(loop, scope, { startImmediately: true })
    }).pipe(Effect.asVoid, Effect.provideContext(buildContext))

    // A subscription counts from its acquire to its release; the first one while
    // the loop is idle starts it (a Cold start).
    const join: Effect.Effect<void> = Effect.suspend(() => {
      MutableRef.increment(subscribers)
      return Bool.match(MutableRef.get(running), { onTrue: () => Effect.void, onFalse: () => start })
    })
    const leave: Effect.Effect<void> = Effect.sync(() => {
      MutableRef.decrement(subscribers)
    })

    // Subscribing joins the tick PubSub, then joins the loop. Join the PubSub
    // FIRST, so no tick published once the loop runs can miss this subscriber.
    const ticks = tracedStream(
      Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.logDebug("wardic.clock: subscribe")
        const subscription = yield* PubSub.subscribe(tickPubSub)
        yield* Effect.acquireRelease(join, () => leave)
        return Stream.fromSubscription(subscription)
      }),
    ),
      "wardic.clock",
    )

    return { ticks, tick, now: syncNow(now) }
  })

/**
 * The Clock over the Environment's `RefreshFrameSource`, its loop in the Layer's scope. An Environment
 * provides both from one source, so the Clock and a binding's flush run on the same frames.
 */
// ADR-0031; `ClockDomLive`. Tier 2 (ADR-0008): for Environment authors.
export const layer: Layer.Layer<Clock, never, RefreshFrameSource.RefreshFrameSource> = Layer.effect(Clock)(
  Effect.flatMap(Effect.service(RefreshFrameSource.RefreshFrameSource), fromRefreshFrames),
)
