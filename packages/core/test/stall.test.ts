// A stall through each single-segment Clock consumer (#23, ADR-0017 *Amendment (#23)*): 60 Hz frames, a
// stall after 100 ms of animation, 60 Hz frames after it. Each step clamps its `dt` at `MAX_DT`, so:
// - a stall up to `MAX_DT` reaches the consumer whole, and it lands where its unstalled frames would
//   have. Motion's animations are time-based (`JSAnimation` samples at `timestamp - startTime`), so
//   Motion lands there too: one row a consumer is pinned against Motion 13.3.0's generators, sampled
//   at that wall time (`.tmp/23-stall/motion-rows.ts` on the bench box; `.tmp` is gitignored);
// - a longer stall advances it `MAX_DT`, and it plays out the rest: it settles that much later than
//   wall time would have it. Motion jumps to where wall time puts it.
// The sequences (`keyframes`, `animate`'s repeats) are one time across their Segments since #226, so a
// stall that crosses a Segment's end lands where Motion's does too.
import * as Easing from "@wardic/core/Easing"
import * as Machine from "@wardic/core/Machine"
import { describe, expect, it } from "vitest"

const F = 1 / 60

type Run = Machine.Machine<{ readonly value: number; readonly done: boolean }>

/** Motion's `easeOut`. */
const EASE_OUT = Easing.cubicBezier(0, 0, 0.58, 1)

/** A drag release's inertia (Motion's drag transition), from 80 px back to its slot. */
const RELEASE = { power: 0.8, timeConstant: 0.75, bounceStiffness: 200, bounceDamping: 40, restDelta: 1, restSpeed: 10, min: 0, max: 0 }

const consumers: ReadonlyArray<readonly [string, () => Run]> = [
  ["tween 1 s", () => Machine.tween(0, 100, { duration: 1, easing: EASE_OUT })],
  ["tween 1 s after a 0.2 s delay", () => Machine.tween(0, 100, { duration: 1, delay: 0.2, easing: EASE_OUT })],
  ["spring 170 / 26 / 1", () => Machine.spring(100, { restDelta: 0.01, restSpeed: 0.01 })],
  ["chase toward a still target", () => Machine.chase(() => 100, { restDelta: 0.01, restSpeed: 0.01 })],
  ["decay from 1,000 px/s", () => Machine.decay(0, 1000)],
  ["inertia: a release back to its slot", () => Machine.inertia(80, 0, RELEASE)],
  ["inertia: a free fling at 1,000 px/s", () => Machine.inertia(0, 1000, { power: 0.8, timeConstant: 0.75, restDelta: 1, restSpeed: 10 })],
  ["keyframes 0 / 60 / 100 over 1 s", () => Machine.keyframes([0, 60, 100], { duration: 1, easing: EASE_OUT })],
  ["animate 0.12 s, repeat 3, mirror", () => Machine.animate(0, 100, { duration: 0.12, repeat: 3, repeatType: "mirror", easing: EASE_OUT })],
  [
    "animate 0.16 s, repeat Infinity, reverse, a 0.05 s repeatDelay",
    () => Machine.animate(0, 100, { duration: 0.16, repeat: Number.POSITIVE_INFINITY, repeatType: "reverse", repeatDelay: 0.05, easing: EASE_OUT }),
  ],
]

/** `n` frames at 60 Hz. */
const frames = (n: number): Array<number> => Array.from({ length: n }, () => F)

/** Each frame's value through `dts`, and the wall time it settles at (`Infinity` if it doesn't). */
const through = (make: () => Run, dts: ReadonlyArray<number>) => {
  const step = make().start()
  const values: Array<number> = []
  let wall = 0
  let settled = Number.POSITIVE_INFINITY
  for (const dt of dts) {
    wall += dt
    const frame = step(dt)
    values.push(frame.value)
    if (frame.done && settled === Number.POSITIVE_INFINITY) settled = wall
  }
  return { values, settled }
}

/** 6 frames, a stall of `stall` s, then `after` frames. */
const stalled = (stall: number, after: number): Array<number> => [...frames(6), stall, ...frames(after)]

describe("a stall up to MAX_DT lands each consumer where its unstalled frames would have (#23)", () => {
  for (const [name, make] of consumers) {
    for (const stallMs of [50, 200, 500]) {
      it(`${name}, a ${stallMs} ms stall`, () => {
        // The stall is a whole number of frames: the unstalled run's frame `6 + k - 1` is at its wall time.
        const k = Math.round(stallMs / (1000 / 60))
        const withStall = through(make, stalled(stallMs / 1000, 600))
        const without = through(make, frames(6 + k + 600))
        expect(withStall.values[6], "the stall's frame").toBeCloseTo(without.values[6 + k - 1]!, 6)
        expect(withStall.values.at(-1), "600 frames later").toBeCloseTo(without.values.at(-1)!, 6)
        // It settles on the first frame at or after its end: the unstalled run's, or the stall's own frame
        // when it ends inside the stall.
        expect(withStall.settled, "settles on the first frame past its end, s").toBeCloseTo(Math.max(without.settled, 6 * F + stallMs / 1000), 9)
      })
    }
  }
})

describe("a longer stall advances MAX_DT, and the consumer plays out the rest (#23)", () => {
  for (const [name, make] of consumers) {
    it(`${name}, a 2,000 ms stall: the frames of a 500 ms one, settling 1.5 s later`, () => {
      const long = through(make, stalled(2, 600))
      const capped = through(make, stalled(Machine.MAX_DT, 600))
      expect(long.values).toEqual(capped.values)
      expect(long.settled - 1.5, "settles 1.5 s later, s").toBeCloseTo(capped.settled, 9)
    })
  }
})

describe("against Motion 13.3.0, at the wall time a 200 ms stall after 100 ms lands on (0.3 s)", () => {
  // Motion's value, and how close Wardic's is: the tweens' cubic-bezier solvers differ (bezier-easing's
  // Newton steps against Motion's subdivision), and the spring is integrated in 1/240 s substeps
  // where Motion's is closed-form. The inertias are the same closed form.
  const rows: ReadonlyArray<readonly [string, () => Run, number, number]> = [
    ["tween 1 s", () => Machine.tween(0, 100, { duration: 1, easing: EASE_OUT }), 44.55308442993555, 0.05],
    ["tween 1 s after a 0.2 s delay", () => Machine.tween(0, 100, { duration: 1, delay: 0.2, easing: EASE_OUT }), 16.03898913890589, 0.05],
    ["spring 170 / 26 / 1", () => Machine.spring(100, { restDelta: 0.01, restSpeed: 0.01 }), 90.28975432882734, 0.06],
    ["inertia: a release back to its slot", () => Machine.inertia(80, 0, RELEASE), 16.657462269063462, 1e-9],
    ["inertia: a free fling at 1,000 px/s", () => Machine.inertia(0, 1000, { power: 0.8, timeConstant: 0.75, restDelta: 1, restSpeed: 10 }), 263.74396317148853, 1e-9],
    // The sequences (#226), each across a Segment's end: `.tmp/226/motion-rows.ts`, `JSAnimation.sample`.
    ["keyframes 0 / 60 / 100 over 1 s", () => Machine.keyframes([0, 60, 100], { duration: 1, easing: EASE_OUT }), 47.1100746531738, 0.05],
    ["animate 0.12 s, repeat 3, mirror", () => Machine.animate(0, 100, { duration: 0.12, repeat: 3, repeatType: "mirror", easing: EASE_OUT }), 68.46233151445631, 0.05],
    [
      "animate 0.16 s, repeat Infinity, reverse, a 0.05 s repeatDelay",
      () => Machine.animate(0, 100, { duration: 0.16, repeat: Number.POSITIVE_INFINITY, repeatType: "reverse", repeatDelay: 0.05, easing: EASE_OUT }),
      61.516176428995095,
      0.05,
    ],
  ]
  for (const [name, make, motion, within] of rows) {
    it(`${name}: within ${within} of Motion's ${motion.toFixed(3)}`, () => {
      const value = through(make, stalled(0.2, 0)).values[6]!
      expect(Math.abs(value - motion)).toBeLessThanOrEqual(within)
    })
  }
})

describe("decay steps in closed form (#23)", () => {
  it("comes to rest at velocity / friction from its start, whatever the frame rate", () => {
    for (const hz of [30, 60, 120, 144, 240]) {
      const { values } = through(() => Machine.decay(0, 1000), Array.from({ length: 30 * hz }, () => 1 / hz))
      // At rest once its speed is under 0.1 px/s: within 0.1 / 3 of 1,000 / 3.
      expect(values.at(-1), `${hz} Hz`).toBeCloseTo(1000 / 3, 1)
    }
  })
})
