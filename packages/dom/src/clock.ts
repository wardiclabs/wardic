/**
 * `ClockDomLive` — the browser realization of `Clock`: core's shared
 * {@link makeRefreshFrameClock} driven by `requestAnimationFrame`, whose callbacks
 * are the browser's Refresh frames. Everything else — the ref-counted Refresh frame
 * loop, the `dt` computation, the `time`/`dt` Atoms and the `wardic.clock` span —
 * lives in core, so every Environment's Clock behaves the same (ADR-0004).
 */
import { Clock, makeRefreshFrameClock } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { AtomRegistry } from "effect/unstable/reactivity"

/**
 * `Clock` Layer backed by `requestAnimationFrame`. Requires the Environment's
 * `AtomRegistry` (the registry consumers read `time`/`dt` from); `DomLive` provides
 * it via `AtomRegistry.layer`, exactly as `testLayer` does.
 *
 * The Refresh frame source is built when the Layer builds, not at module load, so
 * importing `@wardic/dom` never touches `requestAnimationFrame` (SSR-safe), and a
 * test that stubs the global before building the Layer drives this Clock.
 */
export const ClockDomLive: Layer.Layer<Clock, never, AtomRegistry.AtomRegistry> = Layer.effect(Clock)(
  Effect.suspend(() =>
    makeRefreshFrameClock({ requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame }),
  ),
)
