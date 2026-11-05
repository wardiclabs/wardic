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
  requireGlobal("DomClock.layer", "requestAnimationFrame").pipe(
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
 * Core's `Clock` and the Environment's `RefreshFrameSource`, from one `requestAnimationFrame`, needing
 * nothing: the frame loop runs in the Layer's own scope. It reads `requestAnimationFrame` when the Layer
 * is built, not when `@wardic/dom` is imported, so a test that stubs it first drives this Clock. Building
 * it on a server fails, with an error that says it's client-only.
 */
// ADR-0021, decision 7: the client-only error.
export const ClockDomLive: Layer.Layer<Clock.Clock | RefreshFrameSource.RefreshFrameSource> = Clock.layer.pipe(
  Layer.provideMerge(frames),
)
