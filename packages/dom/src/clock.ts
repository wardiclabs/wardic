/**
 * `ClockDomLive` — the browser realization of `Clock` and of the Environment's
 * `RefreshFrameSource` (ADR-0031): `requestAnimationFrame`, whose callbacks are the browser's
 * Refresh frames, as the member, and core's shared `Clock.layer` built from it. The flush gate
 * requests its flushes from the same member, so the Clock and the gate share the browser's
 * frames. Everything else — the ref-counted Refresh frame loop, the `dt` computation and the
 * `wardic.clock` span — lives in core, so every Environment's Clock behaves the same (ADR-0004).
 */
import * as Clock from "@wardic/core/Clock"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import { requireGlobal } from "./require-global.ts"

/**
 * The browser's Refresh frames: `requestAnimationFrame` itself, so the Clock and the gate make
 * the browser's own calls, in the order they make them (ADR-0031, decision 7). `cancelFrame`
 * wraps `cancelAnimationFrame` for the member's `unknown` handle; it runs only on a cancel. Both
 * are read when the Layer builds, after the client-only check.
 */
const frames: Layer.Layer<RefreshFrameSource.RefreshFrameSource> = Layer.effect(RefreshFrameSource.RefreshFrameSource)(
  requireGlobal("ClockDomLive", "requestAnimationFrame").pipe(
    Effect.map((): RefreshFrameSource.Shape => {
      const cancel = cancelAnimationFrame
      return {
        requestFrame: requestAnimationFrame,
        cancelFrame: (handle: unknown) => {
          if (Predicate.isNumber(handle)) cancel(handle)
        },
      }
    }),
  ),
)

/**
 * The `Clock` and the Environment's `RefreshFrameSource`, from one `requestAnimationFrame`,
 * requiring nothing: the Refresh frame loop runs in the Layer's own scope.
 *
 * The source is built when the Layer builds, not at module load, so importing `@wardic/dom` never
 * touches `requestAnimationFrame`, and a test that stubs the global before building the Layer
 * drives this Clock and the gate. Building it on a server (no `requestAnimationFrame`) fails with
 * the client-only error (ADR-0021, decision 7).
 */
export const ClockDomLive: Layer.Layer<Clock.Clock | RefreshFrameSource.RefreshFrameSource> = Clock.layer.pipe(
  Layer.provideMerge(frames),
)
