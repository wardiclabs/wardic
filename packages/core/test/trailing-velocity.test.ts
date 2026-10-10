import * as Velocity from "@wardic/core/Velocity"
import { expect, it } from "@effect/vitest"

// The 100 ms drag direction (ADR-0020, grill decision 3): a port of Motion's
// `getVelocity` (packages/framer-motion/src/gestures/pan/PanSession.ts:383-440 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8). Core `drag`'s own 30 ms velocity is not
// changed; the Reorder group uses this one for its direction only.

/** A point moving along x at `x`, at time `t` ms. */
const at = (t: number, x: number, y = 0): Velocity.TimedPoint => ({ x, y, timeStamp: t })

it("TV1: fewer than two points give no velocity", () => {
  expect(Velocity.trailing([])).toEqual({ x: 0, y: 0 })
  expect(Velocity.trailing([at(0, 10)])).toEqual({ x: 0, y: 0 })
})

it("TV2: it measures from the newest point more than 100 ms older than the last", () => {
  // Walking back from 200: 150 (50 ms), then 90 (110 ms > 100) is the base.
  const history = [at(0, 0), at(50, 50), at(90, 90), at(150, 150), at(200, 200)]
  const v = Velocity.trailing(history)
  expect(v.x).toBeCloseTo((200 - 90) / 0.11, 6)
  expect(v.y).toBe(0)
})

it("TV3: with every point inside 100 ms it measures from the oldest", () => {
  const v = Velocity.trailing([at(0, 0), at(30, 30), at(60, 60)])
  expect(v.x).toBeCloseTo(60 / 0.06, 6)
})

it("TV4: a hold then a flick measures from the second point, not the stale first", () => {
  // history[0] is 540 ms before the last (> 2 x 100) and there are more than 2 points,
  // so Motion skips the pointer-down point and uses history[1] (PanSession.ts:413-420).
  const v = Velocity.trailing([at(0, 0), at(500, 0), at(520, 20), at(540, 40)])
  expect(v.x).toBeCloseTo(40 / 0.04, 6)
})

it("TV5: zero elapsed time gives no velocity, and an infinite component reads 0", () => {
  expect(Velocity.trailing([at(100, 0), at(100, 50)])).toEqual({ x: 0, y: 0 })
  const v = Velocity.trailing([at(0, 0, 0), at(50, Number.POSITIVE_INFINITY, 10)])
  expect(v.x).toBe(0)
  expect(v.y).toBeCloseTo(10 / 0.05, 6)
})

it("TV6: moves 50 ms apart still have a direction (core drag's 30 ms window keeps only the last one there, so it reads 0)", () => {
  const v = Velocity.trailing([at(0, 0), at(50, 5), at(100, 10)])
  expect(v.x).toBeCloseTo(100, 6)
})
