// Issue #14's held-frames metric and the card's check against `expectedHeld`, in
// the node test tier. The real-run fixtures are literals copied from Devin's saved
// Chrome 153 logs: `logs/2026-09-27T20-18-46-222Z-default.json` (default scheduler,
// before the #14 fix) and, for the runs after #2's fix,
// `logs/2026-09-28T18-50-29-479Z-default.json`. The logs are gitignored, so the
// numbers live here. Each fixture keeps the run's origin, its first measure span's
// start and its first samples.
import { describe, expect, it } from "vitest"
import { heldCheckOf, heldFramesOf } from "../src/lab/held-frames.ts"
import { DEFAULT_PAINT_SAMPLER_OPTIONS, type PaintSample, type VisualBox } from "../src/probe/paint-sampler.ts"

const NEAR_PX = DEFAULT_PAINT_SAMPLER_OPTIONS.nearPx
const W = 63.996910095214844

interface Fixture {
  readonly measureStart: number
  readonly origin: VisualBox
  readonly samples: ReadonlyArray<PaintSample>
}

/** One sample at post-paint time `t`, with the fixture's `top` (every fixture moves or grows horizontally only). */
const sampleAt =
  (top: number) =>
  (t: number, frame: number, left: number, width = W): PaintSample => ({ t, frame, box: { left, top, width, height: W } })

/** Scenario 1, a Cold start (a new coordinator on an idle Clock): 3 frames held, the #14 bug. */
const s1At = sampleAt(329.72991943359375)
const coldS1: Fixture = {
  measureStart: 18243.200000047684,
  origin: { left: 67.97067260742188, top: 329.72991943359375, width: W, height: W },
  samples: [
    s1At(18245.200000047684, 1, 67.97067260742188),
    s1At(18256.100000023842, 2, 67.97067260742188),
    s1At(18272.800000071526, 3, 67.97067260742188),
    s1At(18291, 4, 72.92757415771484),
    s1At(18307.399999976158, 5, 83.39366912841797),
    s1At(18326, 6, 97.45782470703125),
  ],
}

/**
 * Scenario 8, a warm start (its animated dot keeps the Clock ticking). It also
 * flashes (#2): sample 0 is the destination, painted before the measure pass, so
 * it is not part of the hold.
 */
const s8At = sampleAt(346.9984436035156)
const warmS8: Fixture = {
  measureStart: 85189.30000007153,
  origin: { left: 560.1619873046875, top: 346.9984436035156, width: W, height: W },
  samples: [
    s8At(85175, 1, 752.1604614257812),
    s8At(85191.30000007153, 2, 560.1619873046875),
    s8At(85207.60000002384, 3, 565.0164794921875),
    s8At(85224.5, 4, 575.6981201171875),
    s8At(85240.89999997616, 5, 589.6592407226562),
    s8At(85257, 6, 604.5869140625),
  ],
}

/** Scenario 2, a Cold start that also flashes: the destination frame (sample 0) precedes the measure pass. */
const s2At = sampleAt(348.5802307128906)
const coldFlashS2: Fixture = {
  measureStart: 6588.600000023842,
  origin: { left: 560.1619873046875, top: 348.5802307128906, width: W, height: W },
  samples: [
    s2At(6573.200000047684, 1, 560.1619873046875, 127.99382019042969),
    s2At(6590.5, 2, 560.1619873046875),
    s2At(6605.700000047684, 3, 560.1619873046875),
    s2At(6622.5, 4, 560.1619873046875),
    s2At(6639.600000023842, 5, 560.1619873046875, 65.61264038085938),
    s2At(6656.600000023842, 6, 560.1619873046875, 69.11035919189453),
  ],
}

/**
 * Scenario 1 after #2's fix, warm: the Measure pass ran at the end of the click task,
 * so the first painted frame is already one step along (log of 2026-09-28T18-50, run 1).
 */
const s1FixedAt = sampleAt(329.72991943359375)
const warmFixedS1: Fixture = {
  measureStart: 3755.2999999523163,
  origin: { left: 259.5757751464844, top: 329.72991943359375, width: W, height: W },
  samples: [
    s1FixedAt(3766.2000000476837, 157, 254.58627319335938),
    s1FixedAt(3782.7000000476837, 158, 244.0561065673828),
    s1FixedAt(3799, 159, 229.84024047851562),
  ],
}

/**
 * Scenario 2 after #2's fix, cold: the Measure pass ran in the engine's
 * ResizeObserver delivery, after the frame's gate flush, so that frame painted the
 * box at its old width and it grew from the next (same log, run 2).
 */
const s2FixedAt = sampleAt(348.5802307128906)
const coldFixedS2: Fixture = {
  measureStart: 6297.600000023842,
  origin: { left: 560.1619873046875, top: 348.5802307128906, width: W, height: W },
  samples: [
    s2FixedAt(6299.600000023842, 309, 560.1619873046875),
    s2FixedAt(6315.799999952316, 310, 560.1619873046875, 65.68431091308594),
    s2FixedAt(6331.799999952316, 311, 560.1619873046875, 69.23905944824219),
  ],
}

const fromMeasure = (f: Fixture) =>
  heldFramesOf(f.samples, f.origin, { from: "measure", at: f.measureStart }, NEAR_PX)

describe("heldFramesOf", () => {
  it("a Cold start before the fix holds 3 frames after the measure pass", () => {
    const held = fromMeasure(coldS1)
    expect(held?.heldFrames).toBe(3)
    expect(held?.msToFirstMotion).toBeCloseTo(18291 - 18243.200000047684, 6)
  })

  it("a warm start before #2's fix holds 1 (the pass painted the origin), and a pre-measure flash frame is not counted", () => {
    const held = fromMeasure(warmS8)
    expect(held?.heldFrames).toBe(1)
    expect(held?.msToFirstMotion).toBeCloseTo(85207.60000002384 - 85189.30000007153, 6)
  })

  it("a resize counts as motion, and a Cold start that also flashes still holds 3", () => {
    expect(fromMeasure(coldFlashS2)?.heldFrames).toBe(3)
  })

  it("a trigger anchor counts every sample (scenario 9: there is no measure pass)", () => {
    // Anchored at the trigger, coldS1's samples hold 3 and move at the 4th.
    const held = heldFramesOf(coldS1.samples, coldS1.origin, { from: "trigger", at: 18242.300000071526 }, NEAR_PX)
    expect(held?.heldFrames).toBe(3)
    expect(held?.msToFirstMotion).toBeCloseTo(18291 - 18242.300000071526, 6)
    // A run whose first sample already moved holds 0.
    const moved = heldFramesOf(coldS1.samples.slice(3), coldS1.origin, { from: "trigger", at: 0 }, NEAR_PX)
    expect(moved?.heldFrames).toBe(0)
  })

  it("keeps the measure frame when its delivery shares the pass's millisecond (Firefox's coarse timer)", () => {
    // Firefox headless, 2026-09-27: trigger 5100, measure pass 5100, frame K delivered 5100.
    const origin: VisualBox = { left: 0, top: 0, width: W, height: W }
    const samples: ReadonlyArray<PaintSample> = [
      { t: 5100, frame: 1, box: origin },
      { t: 5117, frame: 2, box: { ...origin, left: 5 } },
    ]
    expect(heldFramesOf(samples, origin, { from: "measure", at: 5100 }, NEAR_PX)?.heldFrames).toBe(1)
  })

  it("after #2's fix a task-triggered layout run holds 0, and one measured after the gate flush holds 1", () => {
    expect(fromMeasure(warmFixedS1)?.heldFrames).toBe(0)
    expect(fromMeasure(coldFixedS2)?.heldFrames).toBe(1)
  })

  it("is undefined when nothing moved after the anchor", () => {
    const still = coldS1.samples.slice(0, 3)
    expect(heldFramesOf(still, coldS1.origin, { from: "measure", at: coldS1.measureStart }, NEAR_PX)).toBeUndefined()
    expect(heldFramesOf([], coldS1.origin, { from: "trigger", at: 0 }, NEAR_PX)).toBeUndefined()
  })
})

describe("heldCheckOf", () => {
  it("checks a plain expectation whatever the Clock start", () => {
    expect(heldCheckOf(0, 0, "warm")).toEqual({ expected: 0, ok: true })
    expect(heldCheckOf(1, 1, "cold")).toEqual({ expected: 1, ok: true })
    expect(heldCheckOf(1, 0, "cold")).toEqual({ expected: 1, ok: false })
    // A run with no Clock record can still be checked against a plain number.
    expect(heldCheckOf(0, 0, null)).toEqual({ expected: 0, ok: true })
  })

  it("reads a per-Clock expectation with the run's Clock start (scenario 9)", () => {
    const s9 = { cold: 0, warm: 1 }
    expect(heldCheckOf(s9, 0, "cold")).toEqual({ expected: 0, ok: true })
    expect(heldCheckOf(s9, 1, "warm")).toEqual({ expected: 1, ok: true })
    expect(heldCheckOf(s9, 1, "cold")).toEqual({ expected: 0, ok: false })
    expect(heldCheckOf(s9, 0, "warm")).toEqual({ expected: 1, ok: false })
  })

  it("fails a run with no hold (the anchor was never seen, or nothing moved)", () => {
    expect(heldCheckOf(1, null, "warm")).toEqual({ expected: 1, ok: false })
  })

  it("has nothing to check without an expectation, or with a per-Clock one and no Clock record", () => {
    expect(heldCheckOf(undefined, 0, "cold")).toBeUndefined()
    expect(heldCheckOf({ cold: 0, warm: 1 }, 0, null)).toBeUndefined()
  })

  it("checks the real runs after #2's fix against scenario 1's and scenario 2's expectations", () => {
    expect(heldCheckOf(0, fromMeasure(warmFixedS1)?.heldFrames ?? null, "warm")?.ok).toBe(true)
    expect(heldCheckOf(1, fromMeasure(coldFixedS2)?.heldFrames ?? null, "cold")?.ok).toBe(true)
  })
})
