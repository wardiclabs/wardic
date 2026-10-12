/**
 * The `RefreshFrameSource` module: where an Environment's **Refresh frames** come from, one of
 * its members (ADR-0031). Core builds the Clock from it (`Clock.layer`, ADR-0017), and the flush
 * gate requests from it the flush of a write made outside the Frame loop's tick (ADR-0033), so
 * the two run on the same frames and no binding calls `requestAnimationFrame` itself. `@wardic/dom`'s `ClockDomLive` provides
 * `requestAnimationFrame` / `cancelAnimationFrame`; a native or canvas Environment provides its
 * own pair.
 *
 * Tier 2 (ADR-0008): Effect-typed, for Environment and binding authors.
 */
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/**
 * A Refresh frame source: `requestFrame` asks for one callback at the next Refresh frame (passing
 * its timestamp in ms), `cancelFrame` withdraws a pending request. `requestAnimationFrame` /
 * `cancelAnimationFrame` in DOM and native. `Handle` is whatever `requestFrame` returns; the
 * service's is `unknown`.
 *
 * Every source keeps three rules, as `requestAnimationFrame` does (ADR-0031, decision 4):
 * - **It calls back later, never inside `requestFrame` itself.** The Clock requests each next frame
 *   from inside the current callback and doesn't yield in between, so a source that answered
 *   synchronously would spin.
 * - **A Refresh frame's callbacks run in the order they were requested.** The flush gate flushes
 *   what a tick writes inside the Clock's callback, at the end of the Frame loop's tick (ADR-0033),
 *   and requests a frame of its own only for a write made outside a tick: requested before the
 *   Clock's next frame (a drag's move, from its input task), it runs first, on every Environment.
 * - **A callback requested while a frame's callbacks run waits for the next frame.**
 *
 * Call `requestFrame` and `cancelFrame` detached, never as `source.requestFrame(cb)`: a browser
 * throws "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to anything but
 * the window.
 */
export interface Shape<Handle = unknown> {
  readonly requestFrame: (callback: (timestampMs: number) => void) => Handle
  readonly cancelFrame: (handle: Handle) => void
  /**
   * The Environment's monotonic clock, in ms on the same timebase as the Refresh frame
   * timestamps. The Clock reads it to time a Refresh frame whose timestamp repeats the previous
   * one (Firefox runs one right after an input; ADR-0017 as amended by #2). Defaults to
   * `performance.now()`.
   */
  readonly now?: () => number
}

/** The Environment's Refresh frame source. */
export class RefreshFrameSource extends Context.Service<RefreshFrameSource, Shape>()("@wardic/RefreshFrameSource") {}

/** A Layer that provides `source` as the Environment's Refresh frame source. */
export const layer = (source: Shape): Layer.Layer<RefreshFrameSource> => Layer.succeed(RefreshFrameSource, source)
