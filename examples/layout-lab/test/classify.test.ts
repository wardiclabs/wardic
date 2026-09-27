// The lab's run classifier, in the node test tier (paint-sampler.ts touches no DOM
// at import). The real-run fixtures are literals copied from the two saved logs of
// issue #13's session (Chrome 153 and Firefox 156 on Windows, 2026-09-26). The logs
// are gitignored, so the numbers live here. Each fixture keeps the run's origin and
// destination and a subsequence of its samples (sample indices in the comments); a
// full run holds 57.
import { describe, expect, it } from "vitest"
import {
  classify,
  DEFAULT_PAINT_SAMPLER_OPTIONS,
  pathDistance,
  type Thresholds,
  type VisualBox,
} from "../src/probe/paint-sampler.ts"

const thresholds: Thresholds = {
  nearPx: DEFAULT_PAINT_SAMPLER_OPTIONS.nearPx,
  minMovePx: DEFAULT_PAINT_SAMPLER_OPTIONS.minMovePx,
  wrongOriginPx: DEFAULT_PAINT_SAMPLER_OPTIONS.wrongOriginPx,
}

interface Fixture {
  readonly origin: VisualBox
  readonly samples: ReadonlyArray<VisualBox>
}

const run = (fixture: Fixture) =>
  classify(fixture.origin, fixture.samples, fixture.samples[fixture.samples.length - 1]!, thresholds)

const CHROME_W = 63.996910095214844

/** #13, Chrome: s7 (layoutId switch) with the page scrolled. The first frame painted 1350.1px above the origin. */
const chromeS7: Fixture = {
  origin: { left: 67.97067260742188, top: 516.9521484375, width: CHROME_W, height: CHROME_W },
  samples: [
    { left: 67.97067260742188, top: -833.1712646484375, width: CHROME_W, height: CHROME_W }, // 0
    { left: 73.2059097290039, top: -796.3573608398438, width: CHROME_W, height: CHROME_W }, // 3
    { left: 112.56139373779297, top: -519.6116333007812, width: CHROME_W, height: CHROME_W }, // 6
    { left: 192.6717529296875, top: 43.720340728759766, width: 63.99689483642578, height: CHROME_W }, // 12
    { left: 250.47325134277344, top: 450.1776428222656, width: CHROME_W, height: 63.99687957763672 }, // 24
    { left: 258.81695556640625, top: 508.85009765625, width: CHROME_W, height: CHROME_W }, // 36
    { left: 259.7766418457031, top: 515.5985717773438, width: CHROME_W, height: CHROME_W }, // 46
    { left: 259.9691162109375, top: 516.9521484375, width: CHROME_W, height: CHROME_W }, // 47 (settled)
  ],
}

/** #13, Firefox: the same scenario. The first frame painted 1302.0px above the origin. */
const firefoxS7: Fixture = {
  origin: { left: 68, top: 565.5999755859375, width: 64, height: 64 },
  samples: [
    { left: 68, top: -736.4000244140625, width: 64, height: 64 }, // 0
    { left: 72.83332824707031, top: -703.5999755859375, width: 64, height: 64 }, // 3
    { left: 112.38333129882812, top: -435.41668701171875, width: 64, height: 64 }, // 6
    { left: 192.71665954589844, top: 109.33332824707031, width: 64, height: 64 }, // 12
    { left: 250.5, top: 501.1333312988281, width: 64, height: 64 }, // 24
    { left: 258.83331298828125, top: 557.7000122070312, width: 64, height: 64 }, // 36
    { left: 259.79998779296875, top: 564.2666625976562, width: 64, height: 64 }, // 46
    { left: 260, top: 565.5999755859375, width: 64, height: 64 }, // 47 (settled)
  ],
}

/**
 * Same session, Firefox: s1 (click -> layoutDependency), a clean run. Its first frame
 * painted 0.05px behind the origin (before the path starts), a correct first frame.
 */
const firefoxS1Clean: Fixture = {
  origin: { left: 259.7166748046875, top: 312.45001220703125, width: 64, height: 64 },
  samples: [
    { left: 259.76666259765625, top: 312.45001220703125, width: 64, height: 64 }, // 0
    { left: 230.46665954589844, top: 312.45001220703125, width: 64, height: 64 }, // 3
    { left: 184.81666564941406, top: 312.45001220703125, width: 64, height: 64 }, // 6
    { left: 117.51666259765625, top: 312.45001220703125, width: 64, height: 64 }, // 12
    { left: 74.71665954589844, top: 312.45001220703125, width: 64, height: 64 }, // 24
    { left: 68.81666564941406, top: 312.45001220703125, width: 64, height: 64 }, // 36
    { left: 68.23333740234375, top: 312.45001220703125, width: 64, height: 64 }, // 43 (settled)
  ],
}

/** Same session, Firefox: s4 (change inside rAF), a flash. Frame 0 painted the destination, frame 1 was back at the origin. */
const firefoxS4Flash: Fixture = {
  origin: { left: 576, top: 357.3500061035156, width: 64, height: 64 },
  samples: [
    { left: 768, top: 357.3500061035156, width: 64, height: 64 }, // 0
    { left: 576, top: 357.3500061035156, width: 64, height: 64 }, // 1
    { left: 576, top: 357.3500061035156, width: 64, height: 64 }, // 2
    { left: 576, top: 357.3500061035156, width: 64, height: 64 }, // 3
    { left: 581.066650390625, top: 357.3500061035156, width: 64, height: 64 }, // 4
    { left: 605.3333129882812, top: 357.3500061035156, width: 64, height: 64 }, // 6
    { left: 690.1666870117188, top: 357.3500061035156, width: 64, height: 64 }, // 12
    { left: 756.7333374023438, top: 357.3500061035156, width: 64, height: 64 }, // 24
    { left: 766.61669921875, top: 357.3500061035156, width: 64, height: 64 }, // 36
    { left: 767.7666625976562, top: 357.3500061035156, width: 64, height: 64 }, // 46 (settled)
  ],
}

/** A synthetic 200px move to the right. */
const box = (left: number, top = 0): VisualBox => ({ left, top, width: 64, height: 64 })
const moveRight = (first: VisualBox): Fixture => ({
  origin: box(0),
  samples: [first, box(120), box(180), box(198), box(200), box(200)],
})

describe("classify: wrong-origin (issue #13)", () => {
  it("grades Chrome's logged s7 run wrong-origin, 1350.1px above the origin", () => {
    expect(pathDistance(chromeS7.samples[0]!, chromeS7.origin, chromeS7.samples[7]!)).toBeCloseTo(1350.1, 1)
    expect(run(chromeS7)).toEqual({
      verdict: "wrong-origin",
      originOffset: { left: 0, top: -1350.1234130859375, width: 0, height: 0 },
    })
  })

  it("grades Firefox's logged s7 run wrong-origin, 1302.0px above the origin", () => {
    expect(pathDistance(firefoxS7.samples[0]!, firefoxS7.origin, firefoxS7.samples[7]!)).toBeCloseTo(1302.0, 1)
    expect(run(firefoxS7)).toEqual({
      verdict: "wrong-origin",
      originOffset: { left: 0, top: -1302, width: 0, height: 0 },
    })
  })

  it("keeps a correct first frame from a logged clean run clean, with no originOffset", () => {
    const result = run(firefoxS1Clean)
    expect(result).toEqual({ verdict: "clean" })
    expect("originOffset" in result).toBe(false)
  })

  it("is strict at the threshold: 8px off the path is clean, 8.5px is wrong-origin", () => {
    expect(run(moveRight(box(100, 8)))).toEqual({ verdict: "clean" })
    expect(run(moveRight(box(100, 8.5)))).toEqual({
      verdict: "wrong-origin",
      originOffset: { left: 100, top: 8.5, width: 0, height: 0 },
    })
  })
})

describe("classify: existing verdicts are unchanged", () => {
  it("flash: Firefox's logged rAF run (destination frame, then back at the origin)", () => {
    expect(run(firefoxS4Flash)).toEqual({ verdict: "flash", teleportIndex: 0 })
  })

  it("snap: the first frame is already at the destination and stays", () => {
    expect(run({ origin: box(0), samples: [box(200), box(200), box(200)] })).toEqual({ verdict: "snap" })
  })

  it("no-move: origin and destination closer than minMovePx", () => {
    expect(run({ origin: box(0), samples: [box(3), box(5), box(5)] })).toEqual({ verdict: "no-move" })
  })

  it("spring overshoot: passing the destination and swinging back is clean, not a flash", () => {
    const overshoot: Fixture = {
      origin: box(0),
      samples: [box(0), box(90), box(170), box(199.5), box(215), box(206), box(199), box(200.5), box(200), box(200)],
    }
    expect(run(overshoot)).toEqual({ verdict: "clean" })
  })
})

describe("pathDistance", () => {
  const origin = box(0)
  const destination = box(200)

  it("is the distance to the nearest point on the origin-to-destination segment", () => {
    expect(pathDistance(box(50, 3), origin, destination)).toBe(3)
  })

  it("clamps to the ends: a sample behind the origin or past the destination measures to that end", () => {
    expect(pathDistance(box(-6), origin, destination)).toBe(6)
    expect(pathDistance(box(207), origin, destination)).toBe(7)
  })

  it("projects width and height with the same progress as position", () => {
    const small: VisualBox = { left: 0, top: 0, width: 50, height: 50 }
    const large: VisualBox = { left: 100, top: 0, width: 150, height: 50 }
    // Halfway in position and size is on the path; halfway in position at full size is not.
    expect(pathDistance({ left: 50, top: 0, width: 100, height: 50 }, small, large)).toBeCloseTo(0, 9)
    expect(pathDistance({ left: 50, top: 0, width: 150, height: 50 }, small, large)).toBeCloseTo(25, 9)
  })
})
