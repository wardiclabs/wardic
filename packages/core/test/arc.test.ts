// `Arc.make` (#438): Motion's `createArcPath`, its unit tests' cases (motion-dom
// `animation/utils/__tests__/arc.test.ts` at `16c6122`), and the numbers they pin.
import * as Arc from "@wardic/core/Arc"
import { describe, expect, it } from "vitest"

const from = { x: 0, y: 0 }
const right = { x: 200, y: 0 }

describe("Arc.make: Motion's arc() (#438)", () => {
  it("AR1: the start at 0 and the end at 1", () => {
    const at = Arc.make({ strength: 1 })(from, right)
    expect(at(0).x).toBeCloseTo(0)
    expect(at(0).y).toBeCloseTo(0)
    expect(at(1).x).toBeCloseTo(200)
    expect(at(1).y).toBeCloseTo(0)
  })

  it("AR2: strength 1 bulges by half the distance at the middle; strength 0 is the straight line", () => {
    const mid = Arc.make({ strength: 1 })(from, right)(0.5)
    expect(mid.x).toBeCloseTo(100)
    expect(Math.abs(mid.y)).toBeCloseTo(100)
    const straight = Arc.make({ strength: 0 })(from, { x: 200, y: 100 })(0.5)
    expect(straight.x).toBeCloseTo(100)
    expect(straight.y).toBeCloseTo(50)
    expect(Math.abs(Arc.make()(from, right)(0.5).y), "the default curves").toBeGreaterThan(0)
  })

  it("AR3: cw and ccw bulge to opposite sides, turning with the direction of travel", () => {
    const cw = Arc.make({ strength: 1, direction: "cw" })
    expect(Math.sign(cw(from, right)(0.5).y)).toBe(-1)
    expect(Math.sign(cw(right, from)(0.5).y)).toBe(1)
    expect(Math.sign(cw(from, { x: 0, y: 200 })(0.5).x), "down, cw: toward 3 o'clock").toBe(1)
    expect(Math.sign(cw({ x: 0, y: 200 }, from)(0.5).x), "up, cw: toward 9 o'clock").toBe(-1)
    const ccw = Arc.make({ strength: 1, direction: "ccw" })
    expect(Math.sign(ccw(from, right)(0.5).y)).toBe(1)
    expect(Math.sign(ccw(right, from)(0.5).y)).toBe(-1)
  })

  it("AR4: with no direction, one side of the screen: either way along, and when the dominant axis turns", () => {
    expect(Math.sign(Arc.make({ strength: 1 })(from, right)(0.5).y)).toBe(Math.sign(Arc.make({ strength: 1 })(right, from)(0.5).y))
    const arc = Arc.make({ strength: 1 })
    const apex = arc(from, { x: 300, y: 50 })(0.5)
    expect(apex.y, "the first bulges down").toBeGreaterThan(25)
    const second = arc({ x: apex.x, y: apex.y }, { x: 50, y: 300 })(0.5)
    expect(second.y, "the second keeps to that side").toBeGreaterThan(apex.y)
  })

  it("AR5: peak moves the highest point along the way", () => {
    expect(Arc.make({ strength: 1, peak: 0.2 })(from, right)(0.5).x).toBeLessThan(Arc.make({ strength: 1, peak: 0.8 })(from, right)(0.5).x)
  })

  it("AR6: rotate: none without it; 0 at both ends with it; a number scales it", () => {
    expect(Arc.make({ strength: 1 })(from, right)(0.5).rotate).toBeUndefined()
    const turning = Arc.make({ strength: 1, rotate: true })(from, right)
    expect(turning(0.5).rotate).toBeDefined()
    expect(turning(0).rotate).toBeCloseTo(0)
    expect(turning(1).rotate).toBeCloseTo(0)
    const full = Arc.make({ strength: 1, rotate: 1 })(from, right)(0.25).rotate!
    const half = Arc.make({ strength: 1, rotate: 0.5 })(from, right)(0.25).rotate!
    expect(Math.abs(half)).toBeCloseTo(Math.abs(full) * 0.5)
  })

  it("AR7: no distance: stays where it is", () => {
    const mid = Arc.make({ strength: 1 })({ x: 5, y: 10 }, { x: 5, y: 10 })(0.5)
    expect(mid.x).toBeCloseTo(5)
    expect(mid.y).toBeCloseTo(10)
  })
})
