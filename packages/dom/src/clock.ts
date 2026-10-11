/**
 * `ClockDomLive` — the browser realization of `Clock`: core's shared
 * `Clock.fromRefreshFrames` driven by `requestAnimationFrame`, whose callbacks
 * are the browser's Refresh frames. Everything else — the ref-counted Refresh frame
 * loop, the `dt` computation and the `wardic.clock` span — lives in core, so every
 * Environment's Clock behaves the same (ADR-0004).
 */
import * as Clock from "@wardic/core/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { requireGlobal } from "./require-global.ts"

/**
 * `Clock` Layer backed by `requestAnimationFrame`, requiring nothing: the Refresh frame
 * loop runs in the Layer's own scope.
 *
 * The Refresh frame source is built when the Layer builds, not at module load, so
 * importing `@wardic/dom` never touches `requestAnimationFrame`, and a test that stubs
 * the global before building the Layer drives this Clock. Building it on a server (no
 * `requestAnimationFrame`) fails with the client-only error (ADR-0021, decision 7).
 */
export const ClockDomLive: Layer.Layer<Clock.Clock> = Layer.effect(Clock.Clock)(
  requireGlobal("ClockDomLive", "requestAnimationFrame").pipe(
    Effect.andThen(() =>
      Clock.fromRefreshFrames({ requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame })
    ),
  ),
)
