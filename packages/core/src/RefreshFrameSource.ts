/**
 * Where an Environment's Refresh frames come from: the frames its platform draws, each with its time.
 * Core builds the Clock from it (`Clock.layer`), and a binding's flush of a write made outside an
 * animation's tick asks it for a frame too, so both run on the same frames and no binding asks the
 * platform itself. `@wardic/dom` provides its platform's; a native or a canvas Environment provides its
 * own pair.
 *
 * @example
 * import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
 *
 * const source = RefreshFrameSource.layer({
 *   requestFrame: (callback) => platform.nextFrame(callback),
 *   cancelFrame: (handle) => platform.cancelFrame(handle),
 * })
 */
// **Refresh frames**, one of an Environment's members (ADR-0031). The Clock: ADR-0017. The flush gate's
// requests: ADR-0033. `@wardic/dom`'s `DomClock.layer` provides `requestAnimationFrame` /
// `cancelAnimationFrame`. Tier 2 (ADR-0008): Effect-typed, for Environment and binding authors.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/**
 * A Refresh frame source. `Handle` is whatever `requestFrame` gives; the service's is `unknown`. Every
 * source keeps three rules:
 * - **It calls back later, never inside `requestFrame` itself.** The Clock asks for each next frame from
 *   inside the current one's callback and doesn't yield in between, so a source that answered at once
 *   would spin.
 * - **A frame's callbacks run in the order they were asked for.** A binding's flush asks for a frame of
 *   its own only for a write made outside a tick: asked for before the Clock's next frame, as a drag's
 *   move is, it runs first, on every Environment.
 * - **A callback asked for while a frame's callbacks run waits for the next frame.**
 *
 * Core calls `requestFrame` and `cancelFrame` detached, never as `source.requestFrame(cb)`, so a source
 * doesn't rely on `this`.
 */
// The rules are `requestAnimationFrame`'s (ADR-0031, decision 4). The flush gate flushes what a tick
// writes inside the Clock's callback, at the end of the Frame loop's tick (ADR-0033). Detached: a browser
// throws "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to anything but the
// window.
export interface Shape<Handle = unknown> {
  /** Asks for one call of `callback` at the next frame, with the frame's time in ms. */
  readonly requestFrame: (callback: (timestampMs: number) => void) => Handle
  /** Withdraws a call asked for and not yet made. */
  readonly cancelFrame: (handle: Handle) => void
  /**
   * The Environment's steady clock, in ms on the same timebase as the frames' times. The Clock reads it
   * to time a frame whose time repeats the one before, as some platforms' do right after an input.
   * Defaults to `performance.now()`.
   */
  // Firefox runs one right after an input (ADR-0017 as amended by #2).
  readonly now?: () => number
}

/** The Environment's Refresh frame source. */
export class RefreshFrameSource extends Context.Service<RefreshFrameSource, Shape>()("@wardic/RefreshFrameSource") {}

/** A Layer that provides `source` as the Environment's Refresh frame source. */
export const layer = (source: Shape): Layer.Layer<RefreshFrameSource> => Layer.succeed(RefreshFrameSource, source)
