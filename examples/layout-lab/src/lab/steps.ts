/**
 * How a run moved, read from its painted samples: the size of its first steps
 * (`firstSteps`, issue #18) and whether a later Measure pass changed its pace
 * (`passStepRatio`, ADR-0018's rule that a running animation whose box didn't
 * change is left alone).
 *
 * A step is the distance between two consecutive painted boxes, |dLeft| + |dTop| +
 * |dWidth| + |dHeight|, in px. For a box that keeps its size that is |dLeft| +
 * |dTop|, the measure #18's steps were read with (ADR-0018: a newly mounted
 * `layoutId` twin stepped `5.1 4.9 10.3` where a click stepped `5.1 10.7 13.7`); the
 * size terms make a resize (scenario 2) count too. The origin, read at the trigger,
 * stands for the frame before the first sample, so a run whose first painted frame
 * already moved (a task-triggered layout, stepped by the next frame's tick) starts
 * with that step.
 *
 * Pure (no DOM), so the node test tier imports it (`test/steps.test.ts`).
 *
 * @module
 */
import type { PaintSample, VisualBox } from "../probe/paint-sampler.ts"

/** How many steps {@link firstStepsOf} keeps. */
export const FIRST_STEP_COUNT = 3

/** The step from `a` to `b`: |dLeft| + |dTop| + |dWidth| + |dHeight|, in px. */
export const stepBetween = (a: VisualBox, b: VisualBox): number =>
  Math.abs(b.left - a.left) + Math.abs(b.top - a.top) + Math.abs(b.width - a.width) + Math.abs(b.height - a.height)

/**
 * The run's first {@link FIRST_STEP_COUNT} steps, starting at its first step larger
 * than `nearPx` (a smaller one is the element holding at its origin, not motion).
 * Fewer when the samples run out first; empty when no step is larger than `nearPx`.
 */
export const firstStepsOf = (
  origin: VisualBox,
  samples: ReadonlyArray<PaintSample>,
  nearPx: number,
): Array<number> => {
  const steps: Array<number> = []
  let previous = origin
  for (const sample of samples) {
    const step = stepBetween(previous, sample.box)
    previous = sample.box
    if (steps.length === 0 && step <= nearPx) continue
    steps.push(step)
    if (steps.length === FIRST_STEP_COUNT) break
  }
  return steps
}

/**
 * Whether the Measure pass that started at `passAt` changed the run's pace: the two
 * steps from the first sample delivered at or after `passAt`, each divided by the
 * step before it, and whichever ratio is farthest from 1. The lab passes the run's
 * second Measure pass (the first one seeds the run's own animation).
 *
 * About 1 when the pass left the motion alone (an undisturbed spring changes pace by
 * roughly 10% a frame). Well below 1 when it restarted the animation at zero
 * velocity or held a frame, above 1.6 when a frame skipped a step ahead. Two ratios,
 * not one, because a pass that runs after its frame's tick shows a restart
 * only in the step after the first one (ADR-0006 *Amendment (#2)*), and the first
 * read after a trigger can be the previous frame's (its post-paint message may run
 * after the trigger's task).
 *
 * `null` when there is nothing to compare: no such pass (`passAt` is `undefined`),
 * no sample at or after it, no step before it (the pass came before the run's first
 * painted frame, as scenario 7's second pass does), or a step before it of `nearPx`
 * or less (the element was not moving yet, or any more).
 */
export const passStepRatioOf = (
  origin: VisualBox,
  samples: ReadonlyArray<PaintSample>,
  passAt: number | undefined,
  nearPx: number,
): number | null => {
  if (passAt === undefined) return null
  const k = samples.findIndex((s) => s.t >= passAt)
  if (k < 1) return null
  const boxAt = (i: number): VisualBox => (i < 0 ? origin : samples[i].box)
  const stepInto = (i: number): number => stepBetween(boxAt(i - 1), boxAt(i))
  let worst: number | null = null
  for (const i of [k, k + 1]) {
    if (i >= samples.length) break
    const before = stepInto(i - 1)
    if (before <= nearPx) {
      if (i === k) return null
      break
    }
    const ratio = stepInto(i) / before
    if (ratio === 0) return 0 // a held frame: as far from 1 as it gets
    if (worst === null || Math.abs(Math.log(ratio)) > Math.abs(Math.log(worst))) worst = ratio
  }
  return worst
}
