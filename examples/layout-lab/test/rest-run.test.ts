// At-rest runs (#144, scenario 12's X), in the node test tier: the item FLIPs to a moved slot,
// and the card judges where it ends, whether its glued children stayed on it, and whether its
// isolated ones (a layoutRoot and its child) sat at their new place. Fixtures are painted boxes,
// one per frame, as the drag recorder's at-rest read samples them.
import { describe, expect, it } from "vitest"
import type { Box } from "../src/lab/drag-run.ts"
import { REST_CHECK_NAMES, type RestFrame, type RestRunInput, restChecksOf, restRunOf } from "../src/lab/rest-run.ts"

const box = (x: number, y: number, width = 28, height = 28): Box => ({ x, y, width, height })

/** The item's top over the run: from 36 to 86, as X moves scenario 12's slot 50 px down. */
const FLIGHT = [36, 37.2, 41.6, 48.5, 56.8, 64.9, 72, 77.5, 81.5, 84.1, 85.4, 85.9, 86, 86, 86]

/** One frame: the item at `top`, its glued children at their offsets plus `drift`, R and G at their layout boxes plus `off`. */
const frameAt = (k: number, top: number, drift: (k: number) => number = () => 0, off: (k: number) => number = () => 0): RestFrame => ({
  frame: k,
  frameAt: k * 16.7,
  t: k * 16.7 + 4,
  d: box(20, top, 220, 96),
  slot: box(20, 86, 220, 96),
  glued: { c1: box(30, top + 10), c2: box(70, top + 10), m: box(30, top + 60 + drift(k), 24, 24) },
  isolated: {
    r: { painted: box(110, 96 + off(k), 40, 40), layout: box(110, 96, 40, 40) },
    g: { painted: box(118, 104 + off(k), 12, 12), layout: box(118, 104, 12, 12) },
  },
})

const run = (over: Partial<RestRunInput> = {}, drift?: (k: number) => number, off?: (k: number) => number): RestRunInput => ({
  scenarioId: "drag-children",
  trigger: "X",
  startedAt: 0,
  slotBefore: box(20, 36, 220, 96),
  gluedOffsets: { c1: { x: 10, y: 10 }, c2: { x: 50, y: 10 }, m: { x: 10, y: 60 } },
  frames: FLIGHT.map((top, k) => frameAt(k, top, drift, off)),
  endedAt: 300,
  endedBy: "settled",
  scheduler: "default",
  ...over,
})

const EXPECT = { endsOnSlotMaxPx: 0.5, childGlueMaxPx: 1, isolatedMaxPx: 1 }
const lines = (input: RestRunInput) => Object.fromEntries(restChecksOf(restRunOf(input), EXPECT).map((c) => [c.name, c]))

describe("at-rest runs (#144, scenario 12's X)", () => {
  it("AR1: X with #33's and #144's fixes: the item lands on its slot, its children stay on it, R and G stay put", () => {
    const l = lines(run())
    expect(Object.keys(l)).toEqual([...REST_CHECK_NAMES])
    expect(l["slot moved"]).toEqual({ name: "slot moved", ok: true, text: "X · 0.0, 50.0 px · 15 frames" })
    expect(l["ends on slot"]).toEqual({ name: "ends on slot", ok: true, text: "0.00 px ✓" })
    expect(l["child glued"]).toEqual({ name: "child glued", ok: true, text: "c1 0.00 · c2 0.00 · m 0.00 px ✓" })
    expect(l.isolated).toEqual({ name: "isolated", ok: true, text: "r 0.00 · g 0.00 px ✓" })
  })

  it("AR2: #144 before its fix: M snaps 5.6 px off the item as the item lands", () => {
    const snap = (k: number): number => (k < 12 ? 0 : -5.62 + (k - 12) * 0.9)
    const l = lines(run({}, snap))
    expect(l["child glued"]).toEqual({ name: "child glued", ok: false, text: "c1 0.00 · c2 0.00 · m 5.62 px ✗ expected ≤ 1 px" })
    expect(l.isolated.ok).toBe(true)
  })

  it("AR3: #33 before its fix: R rides the item's FLIP, off its new place by what the item has left to go", () => {
    const l = lines(run({}, undefined, (k) => FLIGHT[k]! - 86))
    expect(l.isolated).toEqual({ name: "isolated", ok: false, text: "r 50.00 · g 50.00 px ✗ expected ≤ 1 px" })
    expect(l["child glued"].ok).toBe(true)
  })

  it("AR4: a run cut short by a press isn't judged on where it ends; its other lines still are", () => {
    const frames = FLIGHT.slice(0, 6).map((top, k) => frameAt(k, top))
    const l = lines(run({ frames, endedBy: "next-press" }))
    expect(l["ends on slot"]).toEqual({ name: "ends on slot", ok: true, text: "21.10 px · cut short by a press" })
    expect(l["child glued"].ok).toBe(true)
    expect(l.isolated.ok).toBe(true)
  })

  it("AR5: an item that ends off its slot fails ends on slot", () => {
    const frames = FLIGHT.map((top, k) => frameAt(k, k === FLIGHT.length - 1 ? 84 : top))
    expect(lines(run({ frames }))["ends on slot"]).toEqual({ name: "ends on slot", ok: false, text: "2.00 px ✗ expected ≤ 0.5 px" })
  })
})
