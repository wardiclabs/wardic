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

  it("wins passes a press let go on its way there (a phone's short press), and fails one pulled back", () => {
    const rising = [0.4, 0.6, 0.75, 0.86, 0.93, 0.97, 0.99]
    const held = (shown: ReadonlyArray<number>): Array<LiveFrame> => shown.map((v) => ({ shown: v, live: 0.37, phase: "held" }))
    const series = (frames: ReadonlyArray<LiveFrame>): LiveSeries => ({ frames, lines: ["wins"], held: 1, maxStep: 0.2, tolerance: 0.002 })
    expect(failed(run(series(held(rising))))).toEqual([])
    expect(failed(run(series(held([0.4, 0.6, 0.75, 0.6, 0.45]))))).toEqual(["wins"])
    expect(failed(run(series(held([0.6, 0.9, 1, 1, 0.8]))))).toEqual(["wins"])
  })

  it("a run cut off while its value still moved isn't judged on follows or returns", () => {
    const stuck = good().map((f) => (f.phase === "after" ? { ...f, shown: 0.6 } : f))
    expect(failed(run({ ...SERIES(stuck), maxStep: 1, cut: true }))).toEqual([])
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

describe("liveChecksOf: scenario 19's lines (#234, #233)", () => {
  const series = (frames: ReadonlyArray<LiveFrame>, lines: LiveSeries["lines"], extra: Partial<LiveSeries> = {}): LiveSeries => ({
    frames,
    lines,
    maxStep: Number.POSITIVE_INFINITY,
    tolerance: 0.05,
    ...extra,
  })
  // A scroll moving 20 a frame for 10 frames, then still; the skew leans while it moves.
  const scrolled = (skew: (i: number) => number): Array<LiveFrame> =>
    Array.from({ length: 40 }, (_, i) => ({ shown: skew(i), live: Math.min(i, 10) * 20, phase: "after" }))

  it("moves and settles pass a skew that leans while the scroll moves and stands up after", () => {
    const frames = scrolled((i) => (i <= 10 ? 8 : Math.max(0, 8 - (i - 10) * 2)))
    expect(failed(run(series(frames, ["moves", "settles"])))).toEqual([])
  })

  it("moves fails a skew that never leans; settles fails one that never stands back up", () => {
    expect(failed(run(series(scrolled(() => 0), ["moves"])))).toEqual(["moves"])
    expect(failed(run(series(scrolled(() => 8), ["settles"])))).toEqual(["settles"])
  })

  it("ticks passes a turn at its rate every frame, and fails a stall or a wrong rate", () => {
    const at = (rate: number, stallAt = -1): Array<LiveFrame> =>
      Array.from({ length: 60 }, (_, i) => ({ shown: (i === stallAt ? i - 1 : i) * 16.7 * rate, live: i * 16.7, phase: "after" }))
    expect(failed(run(series(at(0.09), ["ticks"], { rate: 0.09 })))).toEqual([])
    expect(failed(run(series(at(0.09, 30), ["ticks"], { rate: 0.09 })))).toEqual(["ticks"])
    expect(failed(run(series(at(0.06), ["ticks"], { rate: 0.09 })))).toEqual(["ticks"])
  })

  it("updates passes a tell once a frame with what painted, and fails two in a frame or a stale value", () => {
    const frames = (calls: number, off: number): Array<LiveFrame> =>
      Array.from({ length: 5 }, (_, i) => ({ shown: i / 10, live: i / 10, phase: "after", calls, updated: i / 10 + off }))
    expect(failed(run(series(frames(1, 0), ["updates"], { tolerance: 0.002 })))).toEqual([])
    expect(failed(run(series(frames(2, 0), ["updates"], { tolerance: 0.002 })))).toEqual(["updates"])
    expect(failed(run(series(frames(1, 0.1), ["updates"], { tolerance: 0.002 })))).toEqual(["updates"])
  })
})

describe("liveChecksOf: a run read late on most moving frames (#240's phone log)", () => {
  it("moves and updates aren't judged: a busy main thread read most of them late", () => {
    // A scroll moving 20 a frame for 10 frames, all read late (the skew read 0, told twice), then still.
    const frames: Array<LiveFrame> = Array.from({ length: 30 }, (_, i) => ({
      shown: 0,
      live: Math.min(i, 10) * 20,
      phase: "after",
      ...(i < 11 ? { late: true, calls: 2, updated: 0 } : { calls: 0 }),
    }))
    const checks = run({ frames, lines: ["moves", "updates"], maxStep: Number.POSITIVE_INFINITY, tolerance: 0.05 })
    expect(failed(checks)).toEqual([])
    expect(boardChecksOf(checks).filter((c) => c.text.includes("not judged")).map((c) => c.name)).toEqual(["moves", "updates"])
  })

  it("half read on time is judged, on those frames: a skew at rest on them fails moves", () => {
    // Every other moving frame read late (off its rest there); on time it reads 0, a skew that never moved.
    const frames: Array<LiveFrame> = Array.from({ length: 30 }, (_, i) => ({ shown: 0, live: Math.min(i, 10) * 20, phase: "after" }))
    for (const i of [2, 4, 6, 8, 10]) frames[i] = { ...frames[i]!, shown: 5, late: true }
    const checks = run({ frames, lines: ["moves"], maxStep: Number.POSITIVE_INFINITY, tolerance: 0.05 })
    expect(failed(checks)).toEqual(["moves"])
  })

  it("half told on time is judged: told twice on those frames fails updates", () => {
    const frames: Array<LiveFrame> = Array.from({ length: 10 }, (_, i) => ({ shown: i, live: i, phase: "after", calls: 2, updated: i }))
    for (const i of [1, 3, 5, 7, 9]) frames[i] = { ...frames[i]!, calls: 1, late: true }
    const checks = run({ frames, lines: ["updates"], maxStep: Number.POSITIVE_INFINITY, tolerance: 0.05 })
    expect(failed(checks)).toEqual(["updates"])
  })
})

describe("liveChecksOf: resizes (#239)", () => {
  const series = (frames: ReadonlyArray<LiveFrame>): LiveSeries => ({ frames, lines: ["resizes"], maxStep: Number.POSITIVE_INFINITY, tolerance: 0.002 })
  // The box's progress drops from 0.5 to 0.3 as its content grows; the bar reaches it `lag` frames later.
  const grown = (lag: number): Array<LiveFrame> => Array.from({ length: 10 }, (_, i) => ({ shown: i < lag ? 0.5 : 0.3, live: 0.3, phase: "after" }))

  it("passes a bar on the new progress within two frames, and fails one later or never", () => {
    expect(failed(run(series(grown(1))))).toEqual([])
    expect(failed(run(series(grown(2))))).toEqual([])
    expect(failed(run(series(grown(3))))).toEqual(["resizes"])
    expect(failed(run(series(grown(10))))).toEqual(["resizes"])
  })

  it("judges each change in a run: two taps and a scroll between them pass, a slow second change fails", () => {
    // A change at frame 0, the box scrolled down frames 2-4 (the bar on it each frame), and another
    // change at frame 8 that the bar reaches `lag` frames later.
    const live = [0.6, 0.6, 0.55, 0.5, 0.45, 0.45, 0.45, 0.45, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]
    const twice = (lag: number): Array<LiveFrame> =>
      live.map((value, i) => {
        if (i === 0) return { shown: 0.8, live: value, phase: "after" }
        if (i >= 8 && i < 8 + lag) return { shown: 0.45, live: value, phase: "after" }
        return { shown: value, live: value, phase: "after" }
      })
    expect(failed(run(series(twice(1))))).toEqual([])
    expect(failed(run(series(twice(3))))).toEqual(["resizes"])
  })

  it("passes a box at its top, whose progress stays 0", () => {
    expect(failed(run(series(Array.from({ length: 5 }, () => ({ shown: 0, live: 0, phase: "after" })))))).toEqual([])
  })
})

describe("liveChecksOf: a frame read late (lab/frame-counter.ts)", () => {
  it("follows, same frame and updates skip it: it holds the next frame's reads, and two frames' tells", () => {
    const frames: Array<LiveFrame> = [
      { shown: 0.1, live: 0.1, phase: "after", calls: 1, updated: 0.1 },
      // Read after the next frame started: its paint and both frames' tells, against the first frame's value.
      { shown: 0.3, live: 0.2, phase: "after", calls: 2, updated: 0.3, late: true },
      { shown: 0.4, live: 0.4, phase: "after", calls: 1, updated: 0.4 },
      ...Array.from({ length: 5 }, (): LiveFrame => ({ shown: 0.4, live: 0.4, phase: "after", calls: 0 })),
    ]
    const s: LiveSeries = { frames, lines: ["follows", "updates"], maxStep: 1, tolerance: 0.002 }
    expect(failed(run(s))).toEqual([])
    // Read on time, the same frame fails both.
    const onTime = frames.map((f) => ({ ...f, late: false }))
    expect(failed(run({ ...s, frames: onTime }))).toEqual(["updates"])
  })
})
