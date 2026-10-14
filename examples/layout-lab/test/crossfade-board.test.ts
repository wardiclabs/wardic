// Scenario 16's crossfade lines (#5, `crossfadeChecksOf` in `lab/crossfade-board.ts`): a run shaped
// like Motion's crossfade passes, and each line fails the run it's for: a symmetric dissolve, a
// swap, a Follower taking the Lead's point, a nested twin with a fade of its own, a container's
// layout badge stretched off its shape.
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

  it("judges a run the next one cut short only on what it saw before: covers, order, own fade, passes", () => {
    // Cut early, then the twins swapped roles: the Lead's sample ends at 0, the Follower's at 1.
    const cut = { ...run([0.3, 0.6, 0.2, 0], { follower: [1, 1, 1, 1] }), superseded: true }
    expect(failed(cut)).toEqual([])
    expect(failed({ ...run([0.3, 0.6, 0.2, 0], { follower: [1, 1, 1, 1] }) })).toEqual(["end"])
    // A see-through frame before the cut still fails covers, and order with it.
    expect(failed({ ...run([0.5, 0.5], { follower: [0.5, 0.5] }), superseded: true })).toEqual(["covers", "order"])
  })

  it("judges where a run starts against where its twin was painted, by its next step (#170)", () => {
    const lead = ps.map(motionIn)
    const follower = ps.map((p) => 1 - motionOut(p))
    // Half a step from its twin, then a full one: it goes on from there.
    const near = run(lead, { follower, startsFrom: { x: 100, y: 50 }, leadPath: [{ x: 103, y: 50 }, { x: 109, y: 50 }] })
    expect(boardChecksOf(near)[0]).toMatchObject({ name: "starts", ok: true })
    // 30px ahead, as from where the twin would have rested: a jump.
    const jumped = run(lead, { follower, startsFrom: { x: 100, y: 50 }, leadPath: [{ x: 130, y: 50 }, { x: 124, y: 50 }] })
    expect(failed(jumped)).toEqual(["starts"])
    // A run with no record of its start has no starts line.
    expect(boardChecksOf(run(lead, { follower })).map((c) => c.name)).not.toContain("starts")
  })

  it("judges a toggle back, with no twin left to fade, on starts and end only", () => {
    const back = run(ps.map(() => 1), { follower: ps.map(() => null), back: true, startsFrom: { x: 0, y: 0 }, leadPath: [{ x: 1, y: 0 }, { x: 3, y: 0 }] })
    expect(boardChecksOf(back).map((c) => c.name)).toEqual(["starts", "end"])
    expect(failed(back)).toEqual([])
  })

  it("judges each container's layout badge on its own shape, the Follower's too (#169)", () => {
    const lead = ps.map(motionIn)
    const follower = ps.map((p) => 1 - motionOut(p))
    const own = { lead: 4.8, follower: 4 }
    // Both badges hold their shape (within 1%), the Follower's until it's gone.
    const held = ps.slice(0, -1).map(() => ({ lead: 4.8 * 1.01, follower: 3.97 }))
    const kept = run(lead, { follower, ownAspects: own, aspects: [...held, { lead: 4.8, follower: null }] })
    expect(boardChecksOf(kept).find((c) => c.name === "aspect")).toMatchObject({ ok: true })
    // The Follower's badge stretched with its container's lock (#169): off by 30%.
    const stretched = run(lead, { follower, ownAspects: own, aspects: ps.map(() => ({ lead: 4.8, follower: 4 * 0.7 })) })
    expect(failed(stretched)).toEqual(["aspect"])
    expect(boardChecksOf(stretched).find((c) => c.name === "aspect")?.text).toContain("the Follower's badge off its shape by 30.0%")
    // A run with no badges has no aspect line.
    expect(boardChecksOf(run(lead, { follower })).map((c) => c.name)).not.toContain("aspect")
  })

  it("judges a handover that only moves on own fade and end", () => {
    const held = ps.map(() => 1)
    expect(failed(run(held, { follower: [...held.slice(0, -1), 0], onlyMoves: true }))).toEqual([])
    expect(failed(run(ps.map(motionIn), { follower: [...held.slice(0, -1), 0], onlyMoves: true }))).toEqual(["own fade"])
    expect(failed(run(held, { follower: held, onlyMoves: true }))).toEqual(["end"])
  })
})
