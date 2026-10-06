// Scenario 15's board (#47, ADR-0022), in the node test tier: each cell's gesture judged on
// where its painted value starts and where it ends. Fixtures are painted values, one per
// frame, as the board's recorder samples them.
import { describe, expect, it } from "vitest"
import { BOARD_CHECK_NAMES, type BoardRunInput, boardChecksOf } from "../src/lab/base-values-board.ts"

const run = (over: Partial<BoardRunInput>): BoardRunInput => ({
  scenarioId: "base-values",
  cell: "hover scale",
  kind: "gesture",
  base: 1,
  target: 1.5,
  before: 1,
  during: [1, 1.01, 1.05, 1.2, 1.4, 1.5],
  after: [1.48, 1.3, 1.1, 1.01, 1],
  startedAt: 0,
  endedAt: 1000,
  ...over,
})
const lines = (input: BoardRunInput) => Object.fromEntries(boardChecksOf(input).map((c) => [c.name, c]))

describe("base-value board runs (#47, scenario 15)", () => {
  it("BV1: a gesture that starts at its base and returns to it passes both lines", () => {
    const l = lines(run({}))
    expect(Object.keys(l)).toEqual([...BOARD_CHECK_NAMES])
    expect(l.start).toEqual({ name: "start", ok: true, text: "from 1.010 (base 1) ✓" })
    expect(l.end).toEqual({ name: "end", ok: true, text: "back at 1.000 ✓" })
  })

  it("BV2: a gesture that starts from 0 fails start (#47 before its fix)", () => {
    const l = lines(run({ during: [1, 0.12, 0.35, 0.8, 1.3, 1.5] }))
    expect(l.start!.ok).toBe(false)
    expect(l.start!.text).toBe("from 0.120 (base 1) ✗ expected within 0.125 of 1")
  })

  it("BV3: a gesture that never returns fails end", () => {
    const l = lines(run({ after: [1.5, 1.5, 1.5] }))
    expect(l.end).toEqual({ name: "end", ok: false, text: "at 1.500 ✗ expected back at 1" })
  })

  it("BV4: a jump straight to the target fails start", () => {
    expect(lines(run({ during: [1, 1.5, 1.5] })).start!.ok).toBe(false)
  })

  it("BV5: a mount fade starts at the own value and settles at its target", () => {
    const l = lines(run({ cell: "fade, no initial", kind: "mount", base: 1, target: 0.5, before: Number.NaN, during: [1, 0.99, 0.9, 0.7, 0.55, 0.5], after: [] }))
    expect(l.start).toEqual({ name: "start", ok: true, text: "from 1.000 (base 1) ✓" })
    expect(l.end).toEqual({ name: "end", ok: true, text: "settled at 0.500 ✓" })
  })

  it("BV6: a mount fade from 0 fails start", () => {
    const l = lines(run({ kind: "mount", base: 1, target: 0.5, before: Number.NaN, during: [0.03, 0.2, 0.4, 0.5], after: [] }))
    expect(l.start!.ok).toBe(false)
  })

  it("BV7: an exit fades out from its own value; one that vanishes at once fails", () => {
    const fades = lines(run({ cell: "exit", kind: "exit", base: 0.5, target: 0, before: 0.5, during: [0.5, 0.49, 0.4, 0.2, 0.05], after: [] }))
    expect(fades.start!.ok).toBe(true)
    expect(fades.end).toEqual({ name: "end", ok: true, text: "faded out ✓" })
    const vanishes = lines(run({ kind: "exit", base: 0.5, target: 0, before: 0.5, during: [0], after: [] }))
    expect(vanishes.start!.ok).toBe(false)
    expect(vanishes.end!.ok).toBe(false)
  })

  it("BV8: a style change at rest shows within three frames", () => {
    const shows = lines(run({ cell: "style opacity", kind: "style change", base: 0.8, target: 0.8, before: 0.5, during: [0.5, 0.8, 0.8], after: [] }))
    expect(shows.start).toEqual({ name: "start", ok: true, text: "shows 0.800 ✓" })
    expect(shows.end).toEqual({ name: "end", ok: true, text: "at 0.800 ✓" })
    const hidden = lines(run({ kind: "style change", base: 0.8, target: 0.8, before: 0.5, during: [0.5, 0.5, 0.5, 0.5], after: [] }))
    expect(hidden.start!.ok).toBe(false)
    expect(hidden.end!.ok).toBe(false)
  })

  it("BV9: a run with no frames reads ? and fails", () => {
    const l = lines(run({ during: [], after: [] }))
    expect(l.start!.ok).toBe(false)
    expect(l.end!.ok).toBe(false)
  })
})
