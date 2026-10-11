/**
 * Issue #14's metric: how many painted frames an animation holds at its origin
 * before it first moves, counted from an anchor, and how long that takes; and the
 * check of that hold against the scenario's `expectedHeld`.
 *
 * A layout run is anchored at the start of its first `wardic.projection.measure`
 * span (a Measure pass, ADR-0018), so a flash frame (#2) painted before the pass is
 * not counted. A Measure pass at the end of an ordinary task applies its seed at
 * once, and the next frame's tick takes the first step, which the gate paints in
 * that frame (ADR-0033), so that frame, the first painted, is already one step
 * along: 0 held. A pass run after the frame's tick (a ResizeObserver callback, a
 * later rAF callback) paints the seed, which is the origin, in that frame and moves
 * on the next: 1 held. A run with no Measure pass (scenario 9's spring) is anchored
 * at its trigger, so every sample counts. Before #14's fix a Cold start held 3
 * frames on a layout run and 2 on the spring. Between #14's fix and #2's, every
 * layout run held 1, cold or warm, because the pass ran in the next frame's gate
 * callback and painted the origin there. From #14's fix to #73 a cold spring held 0
 * (the Priming tick) and a warm one 1; since #73 both hold 0.
 *
 * Pure (no DOM), so the node test tier imports it (`test/held-frames.test.ts`).
 *
 * @module
 */
import { boxDistance, type PaintSample, type VisualBox } from "../probe/paint-sampler.ts"
import type { ExpectedHeld } from "../scenarios/types.ts"

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

/** A run's hold checked against its scenario's `expectedHeld`. */
export interface HeldCheck {
  /** The hold expected for the run's Clock start. */
  readonly expected: number
  /** Whether the run held exactly {@link expected} frames. A run with no hold (`null`) never does. */
  readonly ok: boolean
}

/**
 * Checks a run's `heldFrames` against `expected`. A number applies to either Clock
 * start; `{ cold, warm }` is read with the run's `clock`. `undefined` when there is
 * nothing to check against: no expectation, or a per-Clock one on a run with no
 * Clock record (`clock` is `null`). A `null` hold (the anchor was never seen, or
 * nothing moved after it) fails the check: the expected motion did not happen.
 */
export const heldCheckOf = (
  expected: ExpectedHeld | undefined,
  heldFrames: number | null,
  clock: ClockStart | null,
): HeldCheck | undefined => {
  if (expected === undefined) return undefined
  let want: number
  if (typeof expected === "number") {
    want = expected
  } else {
    if (clock === null) return undefined
    want = expected[clock]
  }
  return { expected: want, ok: heldFrames === want }
}
