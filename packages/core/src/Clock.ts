/**
 * The `Clock` module: the engine's time source (`Clock.Clock`), and `fromRefreshFrames`, the
 * shared, DOM-free realization of it every Environment builds its Clock from: one
 * shared Refresh frame loop over an Environment's `RefreshFrameSource`. `layer` builds
 * it from the Environment's member (ADR-0031): `@wardic/dom` provides
 * `requestAnimationFrame`/`cancelAnimationFrame`; a native or canvas Environment provides
 * its own pair and gets the same Clock (ADR-0004: no per-Environment re-implementation).
 *
 * The loop is the **single update path**: every Refresh frame computes `dt` from
 * successive timestamps and calls `tick`, which (with the Priming tick below) is the
 * only publisher to the internal tick `PubSub`. There is deliberately no `MAX_DT` clamp
 * here — clamping is a consumer-boundary concern (each leaf's step clamps at
 * `Machine.MAX_DT`, #78), so the Clock reports raw deltas.
 *
 * **Cold start** (ADR-0017): the subscription that starts an idle loop gets a
 * **Priming tick** at the end of its task, with `dt = NOMINAL_DT`, before the first
 * Refresh frame. A start made inside a Refresh frame (a layout animation begins in
 * the gate's measure pass) therefore writes its first moved value in that same
 * frame, and the gate paints it in the next one — exactly like a warm start, whose
 * tick in that frame is already queued. `dt` stays nominal until two Refresh frame
 * timestamps exist (the first Refresh frame has nothing to measure against), then
 * it is the measured interval. The loop never goes through the Effect scheduler:
 * it starts synchronously, reaches the Priming tick via `Microtask.next`, and
 * requests each next Refresh frame inside the current one's callback, after the
 * tick is delivered — so timing is the same in browsers (scheduler =
 * `setTimeout(0)`), React Native and the test harness (scheduler = microtask).
 *
 * Per CONTEXT.md's **Shared source** contract, the loop is shared and counted:
 * the first subscriber to `ticks` starts it, concurrent subscribers share it, and
 * it requests no Refresh frame once nothing is subscribed. It stops the way
 * Motion's frame loop does (ADR-0017, decision 9): the last subscriber leaving
 * does not stop it; the first Refresh frame that finds no subscriber ends it
 * without ticking or requesting another. A subscriber that arrives before that
 * frame — the new animation of a retarget, which `useWardic` starts right after
 * interrupting the old one — joins warm, with no Priming tick and a measured dt.
 *
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect. It is for Environment
 * authors; `InterpolatorRegistry.layer` is the precedent for a shared constructor
 * living in core.
 *
 * Observability (CONTEXT.md observability convention): each subscription to
 * `ticks` runs inside a `wardic.clock` span and emits a debug log on subscribe;
 * the per-frame `tick` path stays quiet — it is the hot path.
 */
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Microtask from "./Microtask.ts"
import * as RefreshFrameSource from "./RefreshFrameSource.ts"

/**
 * Time source for the engine.
 *
 * Exposes a stream of `dt` values, which primitives subscribe to: frame time
 * (CONTEXT.md) is what they count of it. Environments drive it by calling `tick`.
 *
 * Cold start contract (ADR-0017), which `fromRefreshFrames` implements for
 * every Environment driven by Refresh frames: a subscription that starts an idle
 * Clock receives a Priming tick with `dt = NOMINAL_DT` at the end of its task,
 * before the first Refresh frame; `dt` stays nominal until two Refresh frame
 * timestamps exist; no tick depends on the Effect scheduler; and the Clock goes
 * idle only at the first Refresh frame that finds no subscriber, so an unsubscribe
 * followed by a subscribe before it (a retarget) is a warm start.
 */
export class Clock extends Context.Service<Clock, {
  /** Stream of `dt` values, one per frame. */
  readonly ticks: Stream.Stream<number>
  /** Advance the clock to absolute time `t` (environments call this). */
  readonly tick: (t: number) => Effect.Effect<void>
}>()("@wardic/Clock") {}

/**
 * The delta-time (seconds) a Clock reports while it has no measured Refresh frame
 * interval yet: the Priming tick of a Cold start, and the first Refresh frame after
 * it (ADR-0017). One frame at 60 Hz — Motion's first-frame `delta = 1000 / 60`
 * after its frame loop wakes (motion-dom `frameloop/batcher.ts:47-49` @16c6122).
 */
export const NOMINAL_DT = 1 / 60

// @wardic/core compiles against ES2022 alone (no DOM lib, no Node types), which does
// not declare `performance`. It is a host global in every environment Wardic targets
// (browsers, Node, React Native), so it is declared here, in module scope only.
declare const performance: { readonly now: () => number }

/**
 * Build a `Clock` service driven by `source`'s Refresh frames. Requires a `Scope`
 * (the loop runs in it, and is interrupted — its pending request cancelled — when it
 * closes). An Environment provides its source as a member and builds its Clock with
 * {@link layer}; this is for a source that isn't in the Environment.
 *
 * Tier 2 (ADR-0008): Effect-typed, for Environment authors.
 */
export const fromRefreshFrames = <Handle>(
  source: RefreshFrameSource.Shape<Handle>,
): Effect.Effect<Context.Service.Shape<typeof Clock>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Called detached, never as `source.requestFrame(cb)`: a browser throws
    // "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to
    // anything but the window.
    const { requestFrame, cancelFrame } = source
    const now = Option.getOrElse(Option.fromNullishOr(source.now), () => () => performance.now())

    // Carries dt (seconds) to subscribers of `ticks`.
    const tickPubSub = yield* PubSub.unbounded<number>()

    // The previous Refresh frame's time (ms), for dt computation; None => no
    // Refresh frame since the loop started. Only Refresh frames set it — the Priming
    // tick has none (ADR-0017, decision 2). It is the frame's timestamp, except for a
    // frame that repeats the previous timestamp (below).
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

    // The Priming tick: the nominal dt, published to whoever subscribed in the task
    // that started the loop. It has no Refresh frame timestamp, so it leaves
    // `lastTime` alone. Once per Cold start — not the hot path.
    const primingTick: Effect.Effect<void> = PubSub.publish(tickPubSub, NOMINAL_DT).pipe(Effect.asVoid)

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
        // Everyone left before the Priming tick (in the task that started the loop):
        // end here, with no tick and no Refresh frame requested.
        Effect.andThen(
          Effect.suspend(() =>
            Bool.match(MutableRef.get(subscribers) > 0, {
              onTrue: () => primingTick,
              onFalse: () => {
                live = false
                return Effect.void
              },
            }),
          ),
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
    // FIRST: a Cold start queues the Priming tick, and a fiber that yields to the
    // scheduler between the two steps (its op budget ran out) would otherwise let
    // that tick publish to nobody.
    const ticks = Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.logDebug("wardic.clock: subscribe")
        const subscription = yield* PubSub.subscribe(tickPubSub)
        yield* Effect.acquireRelease(join, () => leave)
        return Stream.fromSubscription(subscription)
      }),
    ).pipe(Stream.withSpan("wardic.clock"))

    return { ticks, tick }
  })

/**
 * The Clock over the Environment's `RefreshFrameSource` (ADR-0031): `fromRefreshFrames` on the
 * member, the loop in the Layer's scope. An Environment provides both, from one source, so the
 * Clock and the flush gate run on the same Refresh frames (`ClockDomLive`).
 *
 * Tier 2 (ADR-0008): for Environment authors.
 */
export const layer: Layer.Layer<Clock, never, RefreshFrameSource.RefreshFrameSource> = Layer.effect(Clock)(
  Effect.flatMap(Effect.service(RefreshFrameSource.RefreshFrameSource), fromRefreshFrames),
)
