// A run's first steps and its pace through a second Measure pass (`firstSteps`,
// `passStepRatio`), in the node test tier. The real-run fixtures are literals copied
// from Devin's saved desktop logs, Chrome 153, default scheduler:
// `logs/2026-09-28T06-24-31-748Z-default.json` (before #2's fix) and
// `logs/2026-09-28T18-50-29-479Z-default.json` (after it). The logs are gitignored,
// so the numbers live here. Each fixture keeps the run's origin, its Measure pass
// starts and its first samples.
import { describe, expect, it } from "vitest"
import { DEFAULT_PAINT_SAMPLER_OPTIONS, type PaintSample, type VisualBox } from "../src/probe/paint-sampler.ts"
import { firstStepsOf, passStepRatioOf, stepBetween } from "../src/lab/steps.ts"

const NEAR_PX = DEFAULT_PAINT_SAMPLER_OPTIONS.nearPx
const W = 63.996910095214844

interface Fixture {
  /** The `wardic.projection.measure` span starts at or after the trigger, oldest first. */
  readonly passStarts: ReadonlyArray<number>
  readonly origin: VisualBox
  readonly samples: ReadonlyArray<PaintSample>
}

/** One sample at post-paint time `t` with the fixture's `top` and height. */
const sampleAt =
  (top: number) =>
  (t: number, frame: number, left: number, width = W): PaintSample => ({ t, frame, box: { left, top, width, height: W } })

/** `firstSteps` as the card prints it. */
const printed = (steps: ReadonlyArray<number>): string => steps.map((s) => s.toFixed(1)).join(" ")

/**
 * Scenario 7 before the fix (run 23): the frame after the click's pass painted the
 * origin, and the observer's first delivery ran a second pass that restarted the
 * spring, so the second step dipped: #18's `5.1 4.9 10.3`.
 */
const oldS7At = sampleAt(596.9829711914062)
const oldS7: Fixture = {
  passStarts: [166542.69999992847, 166556.89999997616],
  origin: { left: 67.97067260742188, top: 596.9829711914062, width: W, height: W },
  samples: [
    oldS7At(166545.59999990463, 9174, 67.97067260742188),
    oldS7At(166560.09999990463, 9175, 73.03300476074219),
    oldS7At(166575.09999990463, 9176, 77.96186065673828),
    oldS7At(166591.09999990463, 9177, 88.23199462890625),
    oldS7At(166609.09999990463, 9178, 101.74641418457031),
  ],
}

/**
 * Scenario 7 after the fix (run 11): the click's pass seeded the twin at the end of
 * the task, so the first painted frame had already moved, and the observer's pass
 * (before that frame's paint) left the running twin alone: steps grow.
 */
const fixedS7At = sampleAt(459.69903564453125)
const fixedS7: Fixture = {
  passStarts: [25667.5, 25669],
  origin: { left: 67.97067260742188, top: 459.69903564453125, width: W, height: W },
  samples: [
    fixedS7At(25670, 1470, 73.03312683105469),
    fixedS7At(25682.100000023842, 1471, 83.69783782958984),
    fixedS7At(25698.399999976158, 1472, 97.51842498779297),
    fixedS7At(25715.600000023842, 1473, 112.63856506347656),
  ],
}

/**
 * Scenario 1 after the fix, warm (run 1): one Measure pass. Its twelve samples run
 * from the first step to well past the fastest one.
 */
const s1At = sampleAt(329.72991943359375)
const s1: Fixture = {
  passStarts: [3755.2999999523163],
  origin: { left: 259.5757751464844, top: 329.72991943359375, width: W, height: W },
  samples: [
    s1At(3766.2000000476837, 157, 254.58627319335938),
    s1At(3782.7000000476837, 158, 244.0561065673828, 63.99689483642578),
    s1At(3799, 159, 229.84024047851562),
    s1At(3814.899999976158, 160, 214.73324584960938),
    s1At(3831.899999976158, 161, 199.71607971191406, 63.99689483642578),
    s1At(3848.2999999523163, 162, 184.65049743652344),
    s1At(3865.2000000476837, 163, 170.45204162597656),
    s1At(3881.899999976158, 164, 157.46934509277344),
    s1At(3898.2999999523163, 165, 145.60195922851562),
    s1At(3915.2000000476837, 166, 135.1334228515625),
    s1At(3932.2000000476837, 167, 125.66438293457031, 63.996917724609375),
    s1At(3948.399999976158, 168, 117.30801391601562),
  ],
}

/**
 * Scenario 2 after the fix, cold (run 2): a resize with `left` and `top` fixed. The
 * frame after the pass painted the old width, then the box grew.
 */
const s2At = sampleAt(348.5802307128906)
const s2: Fixture = {
  passStarts: [6297.600000023842],
  origin: { left: 560.1619873046875, top: 348.5802307128906, width: W, height: W },
  samples: [
    s2At(6299.600000023842, 309, 560.1619873046875),
    s2At(6315.799999952316, 310, 560.1619873046875, 65.68431091308594),
    s2At(6331.799999952316, 311, 560.1619873046875, 69.23905944824219),
    s2At(6348.899999976158, 312, 560.1619873046875, 73.81221008300781),
    s2At(6366.299999952316, 313, 560.1619873046875, 78.87550354003906),
  ],
}

const firstSteps = (f: Fixture) => firstStepsOf(f.origin, f.samples, NEAR_PX)
const ratio = (f: Fixture) => passStepRatioOf(f.origin, f.samples, f.passStarts[1], NEAR_PX)

describe("stepBetween", () => {
  it("sums the absolute change of left, top, width and height", () => {
    const a: VisualBox = { left: 10, top: 20, width: 64, height: 64 }
    expect(stepBetween(a, { left: 7, top: 24, width: 64, height: 64 })).toBe(7)
    expect(stepBetween(a, { left: 10, top: 20, width: 66, height: 63 })).toBe(3)
    expect(stepBetween(a, a)).toBe(0)
  })
})

describe("firstStepsOf", () => {
  it("reads #18's hesitation before the fix: the step after the held origin frame, then a dip", () => {
    const steps = firstSteps(oldS7)
    expect(printed(steps)).toBe("5.1 4.9 10.3")
    expect(steps[0]).toBeCloseTo(73.03300476074219 - 67.97067260742188, 9)
    expect(steps[1]).toBeCloseTo(77.96186065673828 - 73.03300476074219, 9)
  })

  it("counts the step from the origin when the first painted frame already moved (after the fix)", () => {
    expect(printed(firstSteps(fixedS7))).toBe("5.1 10.7 13.8")
    const steps = firstSteps(s1)
    expect(steps[0]).toBeCloseTo(259.5757751464844 - 254.58627319335938, 9)
    expect(printed(steps)).toBe("5.0 10.5 14.2")
  })

  it("counts a resize as motion (scenario 2 moves neither left nor top)", () => {
    expect(printed(firstSteps(s2))).toBe("1.7 3.6 4.6")
  })

  it("keeps fewer steps when the samples run out, and none when nothing moved", () => {
    expect(firstStepsOf(s1.origin, s1.samples.slice(0, 2), NEAR_PX)).toHaveLength(2)
    const still = s2.samples.slice(0, 1)
    expect(firstStepsOf(s2.origin, still, NEAR_PX)).toEqual([])
    expect(firstStepsOf(s2.origin, [], NEAR_PX)).toEqual([])
  })
})

describe("passStepRatioOf", () => {
  it("is null for a run with one Measure pass", () => {
    expect(ratio(s1)).toBeNull()
    expect(ratio(s2)).toBeNull()
  })

  it("is null when the second pass came before the first painted frame (scenario 7 after the fix)", () => {
    expect(ratio(fixedS7)).toBeNull()
  })

  it("is null when the element was not moving before the second pass (scenario 7 before the fix held its origin)", () => {
    expect(ratio(oldS7)).toBeNull()
  })

  it("is null when no sample was delivered at or after the pass", () => {
    expect(passStepRatioOf(s1.origin, s1.samples, 4000, NEAR_PX)).toBeNull()
  })

  it("reads the two steps from the first sample after a mid-flight pass, and keeps the ratio farthest from 1", () => {
    // A second pass placed by hand between frames 164 and 165 of scenario 1's run
    // (the run itself had one): an undisturbed spring past its fastest step, slowing.
    const r = passStepRatioOf(s1.origin, s1.samples, 3885.5, NEAR_PX)
    const into165 = (157.46934509277344 - 145.60195922851562) / (170.45204162597656 - 157.46934509277344)
    const into166 = (145.60195922851562 - 135.1334228515625) / (157.46934509277344 - 145.60195922851562)
    expect(r).toBeCloseTo(Math.min(into165, into166), 9) // both below 1: the lower is farther
    expect(r).toBeGreaterThan(0.85)
    expect(r).toBeLessThan(1)
    // A pass at the exact delivery time of frame 165 still picks frame 165.
    expect(passStepRatioOf(s1.origin, s1.samples, 3898.2999999523163, NEAR_PX)).toBe(r)
  })

  it("reads a skip ahead followed by a held frame as 0 (the whole gate flushed early)", () => {
    // The same run with frame 165 painted where frame 166 was: the step into 165 is
    // about twice the one before it, and the step into 166 is zero.
    const skipped = s1.samples.map((s) => (s.frame === 165 ? { ...s, box: s1.samples[9].box } : s))
    expect(passStepRatioOf(s1.origin, skipped, 3885.5, NEAR_PX)).toBe(0)
  })

  it("reads a skip ahead on the run's last pair of frames as above 1.6", () => {
    const skipped = s1.samples.slice(0, 9).map((s) => (s.frame === 165 ? { ...s, box: s1.samples[9].box } : s))
    const r = passStepRatioOf(s1.origin, skipped, 3885.5, NEAR_PX)
    expect(r).toBeCloseTo((157.46934509277344 - 135.1334228515625) / (170.45204162597656 - 157.46934509277344), 9)
    expect(r).toBeGreaterThan(1.6)
  })

  it("catches a restart that shows only in the second step after the pass", () => {
    // Frame 166 barely moves from 165: a spring restarted at zero velocity.
    const restarted = s1.samples.map((s) =>
      s.frame === 166 ? { ...s, box: { ...s1.samples[8].box, left: s1.samples[8].box.left - 2 } } : s,
    )
    const r = passStepRatioOf(s1.origin, restarted, 3885.5, NEAR_PX)
    expect(r).toBeCloseTo(2 / (157.46934509277344 - 145.60195922851562), 9)
    expect(r).toBeLessThan(0.6)
  })

  it("measures the step before a pass on the run's second sample from the origin", () => {
    // A pass between frames 157 and 158: the step before is origin -> frame 157.
    const r = passStepRatioOf(s1.origin, s1.samples, 3770, NEAR_PX)
    expect(r).toBeCloseTo(
      stepBetween(s1.samples[0].box, s1.samples[1].box) / stepBetween(s1.origin, s1.samples[0].box),
      9,
    )
  })
})

describe("JSON safety", () => {
  it("round-trips firstSteps and passStepRatio unchanged", () => {
    const fields = {
      firstSteps: firstSteps(s1),
      passStepRatio: passStepRatioOf(s1.origin, s1.samples, 3885.5, NEAR_PX),
      noRatio: ratio(fixedS7),
    }
    expect(JSON.parse(JSON.stringify(fields))).toEqual(fields)
  })
})
