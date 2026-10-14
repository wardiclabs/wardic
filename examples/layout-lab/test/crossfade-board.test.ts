// Scenario 16's crossfade lines (#5, `crossfadeChecksOf` in `lab/crossfade-board.ts`): a run shaped
// like Motion's crossfade passes, and each line fails the run it's for: a symmetric dissolve, a
// swap, a Follower taking the Lead's point, a nested twin with a fade of its own.
import { describe, expect, it } from "vitest"
import type { BoardRunInput } from "../src/lab/base-values-board.ts"
import { boardChecksOf } from "../src/lab/base-values-board.ts"
import type { CrossfadeSeries } from "../src/lab/crossfade-board.ts"

const ps = Array.from({ length: 21 }, (_, i) => i / 20)
const circOut = (p: number): number => Math.sin(Math.acos(1 - p))
const motionIn = (p: number): number => {
  if (p >= 0.5) return 1
  return circOut(p / 0.5)
}
const motionOut = (p: number): number => {
  if (p <= 0.5) return 0
  if (p >= 0.95) return 1
  return (p - 0.5) / 0.45
}

const run = (lead: ReadonlyArray<number>, crossfade: CrossfadeSeries): BoardRunInput => ({
  scenarioId: "crossfade",
  cell: "overlap",
  kind: "crossfade",
  base: 0,
  target: 1,
  before: Number.NaN,
  during: lead,
  after: [],
  startedAt: 0,
  endedAt: 1,
  crossfade,
})
const failed = (input: BoardRunInput): Array<string> => boardChecksOf(input).filter((c) => !c.ok).map((c) => c.name)

describe("crossfadeChecksOf", () => {
  it("passes a crossfade on Motion's curves, with the Follower gone at the end", () => {
    const lead = ps.map(motionIn)
    const follower = [...ps.map((p) => 1 - motionOut(p)).slice(0, -1), null]
    expect(failed(run(lead, { follower, hitsFollower: ps.map(() => false) }))).toEqual([])
    expect(boardChecksOf(run(lead, { follower })).map((c) => c.name)).toEqual(["covers", "order", "fades", "end"])
  })

  it("fails a symmetric dissolve on covers and order: see-through at its middle, the Follower out before the Lead is in", () => {
    expect(failed(run(ps, { follower: ps.map((p) => 1 - p) }))).toEqual(["covers", "order"])
  })

  it("fails a swap on fades", () => {
    expect(failed(run(ps.map(() => 1), { follower: ps.map(() => 0) }))).toEqual(["fades"])
  })

  it("fails a Follower that took the Lead's point on passes, and one left showing on end", () => {
    const lead = ps.map(motionIn)
    const follower = ps.map((p) => 1 - motionOut(p))
    expect(failed(run(lead, { follower, hitsFollower: ps.map((p) => p < 0.3) }))).toEqual(["passes"])
    expect(failed(run(lead, { follower: [...follower.slice(0, -1), 0.5] }))).toEqual(["end"])
  })

  it("judges a handover that only moves on own fade and end", () => {
    const held = ps.map(() => 1)
    expect(failed(run(held, { follower: [...held.slice(0, -1), 0], onlyMoves: true }))).toEqual([])
    expect(failed(run(ps.map(motionIn), { follower: [...held.slice(0, -1), 0], onlyMoves: true }))).toEqual(["own fade"])
    expect(failed(run(held, { follower: held, onlyMoves: true }))).toEqual(["end"])
  })
})
