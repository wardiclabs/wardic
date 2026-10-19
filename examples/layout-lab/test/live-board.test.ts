// Scenario 18's live lines (#130, `liveChecksOf` in `lab/live-board.ts`): a run where the element
// follows its Live value at rest, a hover wins over it, and the return chases it home passes; each
// line fails the run it's for: a frame behind at rest, a hover the Live value overwrote, a return
// that jumps to the value or never lands, a derived key a frame behind its source.
import { describe, expect, it } from "vitest"
import type { BoardRunInput } from "../src/lab/base-values-board.ts"
import { boardChecksOf } from "../src/lab/base-values-board.ts"
import { type LiveFrame, type LiveSeries, landingOf } from "../src/lab/live-board.ts"

const run = (live: LiveSeries): BoardRunInput => ({
  scenarioId: "live-values",
  cell: "scroll opacity",
  kind: "live",
  base: 0,
  target: 1,
  before: Number.NaN,
  during: [],
  after: [],
  startedAt: 0,
  endedAt: 1,
  live,
})
const failed = (input: BoardRunInput): Array<string> => boardChecksOf(input).filter((c) => !c.ok).map((c) => c.name)

/** A Live value moving 0.01 a frame from 0.3 until frame 25, and the hover's 1 over it from frame 5 to 12. */
const liveAt = (i: number): number => 0.3 + Math.min(i, 25) * 0.01
const good = (): Array<LiveFrame> => {
  const frames: Array<LiveFrame> = []
  for (let i = 0; i < 5; i++) frames.push({ shown: liveAt(i), live: liveAt(i), phase: "rest" })
  for (let i = 5; i < 12; i++) frames.push({ shown: Math.min(1, liveAt(4) + (i - 4) * 0.15), live: liveAt(i), phase: "held" })
  // The way back: a spring closing in on the moving value, then on it.
  let shown = frames[frames.length - 1]!.shown
  for (let i = 12; i < 50; i++) {
    shown = Math.abs(shown - liveAt(i)) < 0.002 ? liveAt(i) : shown + (liveAt(i) - shown) * 0.25
    frames.push({ shown, live: liveAt(i), phase: "after" })
  }
  return frames
}
const SERIES = (frames: ReadonlyArray<LiveFrame>): LiveSeries => ({ frames, lines: ["follows", "wins", "returns"], held: 1, maxStep: 0.2, tolerance: 0.002 })

describe("liveChecksOf", () => {
  it("passes a run that follows at rest, holds the hover and chases the value home", () => {
    expect(boardChecksOf(run(SERIES(good()))).map((c) => [c.name, c.ok])).toEqual([
      ["follows", true],
      ["wins", true],
      ["returns", true],
    ])
  })

  it("follows fails a frame behind at rest", () => {
    const frames = good().map((f, i) => (f.phase === "rest" && i > 0 ? { ...f, shown: liveAt(i - 1) } : f))
    expect(failed(run(SERIES(frames)))).toEqual(["follows"])
  })

  it("wins fails a hover the Live value overwrote", () => {
    const frames = good().map((f) => (f.phase === "held" ? { ...f, shown: f.live } : f))
    expect(failed(run(SERIES(frames)))).toContain("wins")
  })

  it("returns fails a jump to the value, and a return that never lands", () => {
    const jumped = good().map((f) => (f.phase === "after" ? { ...f, shown: f.live } : f))
    expect(failed(run(SERIES(jumped)))).toEqual(["returns"])
    const stuck = good().map((f) => (f.phase === "after" ? { ...f, shown: 0.6 } : f))
    // Never landed: follows judges the frames at rest alone.
    expect(failed(run({ ...SERIES(stuck), maxStep: 1 }))).toEqual(["returns"])
  })

  it("same frame fails a derived key a frame behind its source", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i * 5)
    const map = (x: number): number => 1 - x / 150
    const withIt: Array<LiveFrame> = xs.map((x) => ({ shown: x, live: x, phase: "held", derived: map(x), expected: map(x) }))
    const behind: Array<LiveFrame> = xs.map((x, i) => ({ shown: x, live: x, phase: "held", derived: map(xs[Math.max(0, i - 1)]!), expected: map(x) }))
    const series = (frames: ReadonlyArray<LiveFrame>): LiveSeries => ({ frames, lines: ["same frame"], maxStep: 100, tolerance: 0.002 })
    expect(failed(run(series(withIt)))).toEqual([])
    expect(failed(run(series(behind)))).toEqual(["same frame"])
  })

  it("landingOf is the first frame from which every frame is on it", () => {
    const f = (shown: number): LiveFrame => ({ shown, live: 1, phase: "after" })
    expect(landingOf([f(0.5), f(1), f(0.9), f(1), f(1)], 0.002)).toBe(3)
    expect(landingOf([f(0.5)], 0.002)).toBeUndefined()
  })
})
