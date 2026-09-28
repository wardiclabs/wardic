/**
 * Issue #14's metric: how many painted frames an animation holds at its origin
 * before it first moves, counted from an anchor, and how long that takes.
 *
 * A layout run is anchored at the start of its `wardic.projection.measure` span:
 * the measure pass paints the origin (the FLIP's first frame, a correct hold of 1),
 * and a flash frame (#2) painted before the pass is not counted. A run with no
 * measure pass (scenario 9's spring) is anchored at its trigger, so every sample
 * counts. Before #14's fix a Cold start held 3 frames on a layout run and 2 on the
 * spring; after it, a layout run holds 1 either way and a cold spring holds 0.
 *
 * Pure (no DOM), so the node test tier imports it (`test/held-frames.test.ts`).
 *
 * @module
 */
import { boxDistance, type PaintSample, type VisualBox } from "../probe/paint-sampler.ts"

/** What a run's held count is anchored at: its first measure pass, or its trigger. */
export type HeldFrom = "measure" | "trigger"

/** Whether the Clock was already ticking when the run was triggered. */
export type ClockStart = "cold" | "warm"

/** A run's hold before its first motion. */
export interface Held {
  /** Painted samples within `nearPx` of the origin, from the anchor until the first one that moved. */
  readonly heldFrames: number
  /** Milliseconds from the anchor to the post-paint delivery of the first moved sample. */
  readonly msToFirstMotion: number
}

/**
 * The run's hold before its first motion, or `undefined` when no sample after the
 * anchor moved. For a `measure` anchor at time `at`, only samples delivered at or
 * after `at` count; for a `trigger` anchor, every sample does (the sampler's samples are
 * exactly the frames painted after the trigger).
 */
export const heldFramesOf = (
  samples: ReadonlyArray<PaintSample>,
  origin: VisualBox,
  anchor: { readonly from: HeldFrom; readonly at: number },
  nearPx: number,
): Held | undefined => {
  let held = 0
  for (const sample of samples) {
    // `<`, not `<=`: Firefox coarsens `performance.now()` to whole ms, so the measure
    // frame's own delivery can share the pass's millisecond. A frame painted before
    // the pass was delivered a whole frame earlier, so a tie is always the measure frame.
    if (anchor.from === "measure" && sample.t < anchor.at) continue
    if (boxDistance(sample.box, origin) <= nearPx) {
      held++
      continue
    }
    return { heldFrames: held, msToFirstMotion: sample.t - anchor.at }
  }
  return undefined
}
