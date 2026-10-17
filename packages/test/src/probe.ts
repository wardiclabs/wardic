import * as Probe from "@wardic/core/Probe"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import { Atom } from "effect/reactivity"

const ZERO_BOUNDS: Probe.Bounds = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }
const VIEWPORT = { width: 1024, height: 768 }

/** Options for the static test Probe. */
export interface TestProbeOptions {
  readonly bounds?: Probe.Bounds
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
export const layer = (options: TestProbeOptions = {}): Layer.Layer<Probe.Probe> => {
  const { intersection = [] } = options
  return Layer.succeed(Probe.Probe, { ...fixed(options), observeIntersection: () => Stream.fromIterable(intersection) })
}

/** Both Probes' fixed part: the bounds, the viewport and the preference, each defaulted, and no resizes. */
const fixed = ({ bounds = ZERO_BOUNDS, viewport = VIEWPORT, prefersReducedMotion = false }: TestProbeOptions) => ({
  measure: () => Effect.sync(() => bounds),
  viewport: Atom.make(viewport),
  prefersReducedMotion: Atom.make(prefersReducedMotion),
  observeResize: () => Stream.empty,
})

/**
 * A push-based Probe for tests that need to interleave intersection
 * (in-view/out-of-view) transitions with other effects on their own schedule —
 * mirroring {@link TestInput.pushable}. `observeIntersection(target)` subscribes
 * to a broadcast `PubSub`, so every subscriber sees the same transitions and only
 * events pushed *after* a subscription is live reach it. `pushIntersection`
 * doesn't yield: a waiting subscriber handles the transition inside the publish,
 * as `TestInput.pushable`'s do (ADR-0032). measure/viewport/prefersReducedMotion
 * /observeResize behave as in {@link layer}.
 */
export const pushable = (options: TestProbeOptions = {}): Effect.Effect<{
  readonly layer: Layer.Layer<Probe.Probe>
  readonly pushIntersection: (inView: boolean) => Effect.Effect<void>
}> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<boolean>()
    return {
      layer: Layer.succeed(Probe.Probe, { ...fixed(options), observeIntersection: () => Stream.fromPubSub(pubsub) }),
      pushIntersection: (inView: boolean) =>
        PubSub.publish(pubsub, inView).pipe(Effect.asVoid),
    }
  })
