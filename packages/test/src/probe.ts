import { type Bounds, Probe } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import { Atom } from "effect/reactivity"

const ZERO_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }

/** Options for the static test Probe. */
export interface TestProbeOptions {
  readonly bounds?: Bounds
  readonly viewport?: { readonly width: number; readonly height: number }
  readonly prefersReducedMotion?: boolean
  /**
   * Script of intersection (in-view) booleans replayed by `observeIntersection`.
   * Mirrors the InputSource test harness: omitted (or empty) means the stream
   * emits nothing, preserving back-compat with the silent default.
   */
  readonly intersection?: ReadonlyArray<boolean>
}

/**
 * A static Probe: fixed bounds/viewport. `observeIntersection` replays the
 * optional `intersection` script via `Stream.fromIterable` (empty by default, so
 * it emits nothing); `observeResize` stays empty.
 */
export const layer = (options: TestProbeOptions = {}): Layer.Layer<Probe> =>
  Layer.succeed(Probe, {
    measure: () => Effect.sync(() => options.bounds ?? ZERO_BOUNDS),
    viewport: Atom.make(options.viewport ?? { width: 1024, height: 768 }),
    prefersReducedMotion: Atom.make(options.prefersReducedMotion ?? false),
    observeResize: () => Stream.empty,
    observeIntersection: () => Stream.fromIterable(options.intersection ?? []),
  })

/**
 * A push-based Probe for tests that need to interleave intersection
 * (in-view/out-of-view) transitions with other effects on their own schedule —
 * mirroring {@link TestInput.pushable}. `observeIntersection(target)` subscribes
 * to a broadcast `PubSub`, so every subscriber sees the same transitions and only
 * events pushed *after* a subscription is live reach it. `pushIntersection`
 * yields a small budget of scheduler turns after publishing so subscribers drain
 * deterministically before the next push. measure/viewport/prefersReducedMotion
 * /observeResize behave as in {@link layer}.
 */
export const pushable = (options: TestProbeOptions = {}): Effect.Effect<{
  readonly layer: Layer.Layer<Probe>
  readonly pushIntersection: (inView: boolean) => Effect.Effect<void>
}> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<boolean>()
    const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })
    return {
      layer: Layer.succeed(Probe, {
        measure: () => Effect.sync(() => options.bounds ?? ZERO_BOUNDS),
        viewport: Atom.make(options.viewport ?? { width: 1024, height: 768 }),
        prefersReducedMotion: Atom.make(options.prefersReducedMotion ?? false),
        observeResize: () => Stream.empty,
        observeIntersection: () => Stream.fromPubSub(pubsub),
      }),
      pushIntersection: (inView: boolean) =>
        PubSub.publish(pubsub, inView).pipe(Effect.flatMap(() => drain)),
    }
  })
