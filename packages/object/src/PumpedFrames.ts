/**
 * Refresh frames the host pumps: Wardic's frames are the host loop's, so its writes land in the frame
 * that draws them (a scene's **Host loop**: three's `setAnimationLoop`, an XR session's, a game loop).
 * The host calls {@link PumpedFrames.frame} once a frame, before it renders, with the frame's time in
 * ms, and a loop that draws only on demand asks {@link PumpedFrames.wantsFrame} whether Wardic wants
 * another.
 *
 * @example
 * import * as PumpedFrames from "@wardic/object/PumpedFrames"
 *
 * const frames = PumpedFrames.make()
 * renderer.setAnimationLoop((time) => {
 *   frames.frame(time)
 *   renderer.render(scene, camera)
 * })
 */
// `@wardic/object/PumpedFrames` (#882, ADR-0068 decision 5; ADR-0073, *Amendment (#882)*, Q4): core's
// `RefreshFrameSource`, keeping its three rules. The canvas note's P1 prototyped it, and P5 found frames
// pumped before the render never a frame late, where window rAF is whenever the scene's loop asked first.
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Layer from "effect/Layer"

/** A callback a frame runs, with its time in ms: its own handle, as `cancelFrame` takes it. */
type Callback = (timestampMs: number) => void

/** Refresh frames the host pumps: core's frame source, and what the host calls. */
export interface PumpedFrames extends RefreshFrameSource.Shape<Callback> {
  /**
   * Run the frame: every callback asked for before it, with `time` in ms, on the same timebase as
   * `now`. Call it once a frame, before rendering.
   */
  readonly frame: (time: number) => void
  /** Whether a callback waits for the next frame: what a loop that draws on demand checks to go on. */
  readonly wantsFrame: () => boolean
}

/** What `performance.now()` is, where the host has one. */
// @wardic/object compiles against ES2022 alone, which doesn't declare `performance`: a host global
// wherever Wardic runs (see core's `refresh-frame-clock.ts`).
declare const performance: { readonly now: () => number }

/**
 * Frames the host pumps. `now` is the host's steady clock on its frames' timebase, `performance.now()`
 * when left out; core's Clock reads it to time a frame whose time repeats the one before.
 */
export const make = (now: () => number = () => performance.now()): PumpedFrames => {
  // This frame's callbacks and the next's, swapped each frame: nothing allocated a frame.
  let queue: Array<Callback> = []
  let running: Array<Callback> = []
  const requestFrame = (callback: Callback): Callback => {
    queue.push(callback)
    return callback
  }
  const cancelFrame = (handle: Callback): void => {
    const at = queue.indexOf(handle)
    if (at >= 0) queue.splice(at, 1)
  }
  const frame = (time: number): void => {
    // A callback asked for while this frame's run waits for the next (the source's third rule).
    const due = queue
    queue = running
    running = due
    for (let i = 0; i < due.length; i++) due[i](time)
    due.length = 0
  }
  return { requestFrame, cancelFrame, now, frame, wantsFrame: () => queue.length > 0 }
}

/** `frames` as the Environment's Refresh frame source. */
export const layer = (frames: PumpedFrames): Layer.Layer<RefreshFrameSource.RefreshFrameSource> => RefreshFrameSource.layer(frames as RefreshFrameSource.Shape)
