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
    // `rests` is only for a run back to `none` (#61).
    expect(Object.keys(l)).toEqual(BOARD_CHECK_NAMES.filter((name) => name !== "rests"))
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

  it("BV10: a toggle from none grows from 0 and settles at its target; one that switches at once fails start (#61)", () => {
    const grows = lines(run({ cell: "shadow from none", kind: "toggle", base: 0, target: 10, before: 0, during: [0, 0.4, 1.5, 4, 7.5, 9.6, 10], after: [] }))
    expect(grows.start).toEqual({ name: "start", ok: true, text: "from 0.400 (base 0) ✓" })
    expect(grows.end).toEqual({ name: "end", ok: true, text: "settled at 10.000 ✓" })
    expect(grows.rests).toBeUndefined()
    const switches = lines(run({ cell: "shadow from none", kind: "toggle", base: 0, target: 10, before: 0, during: [0, 10, 10, 10], after: [] }))
    expect(switches.start!.ok).toBe(false)
  })

  it("BV11: a toggle back to none rests at none itself; one resting at its zero fails rests (#61)", () => {
    const back = { cell: "blur from none", kind: "toggle" as const, base: 4, target: 0, before: 4, during: [4, 3.6, 2, 0.5, 0], after: [] }
    expect(lines(run({ ...back, rest: { value: "none", expected: "none" } })).rests).toEqual({ name: "rests", ok: true, text: "none ✓" })
    expect(lines(run({ ...back, rest: { value: "blur(0px)", expected: "none" } })).rests).toEqual({
      name: "rests",
      ok: false,
      text: "blur(0px) ✗ expected none",
    })
  })

  it("BV12: a gesture marked blendsBack must blend on its way back; a switch back fails end (#61)", () => {
    const hover = { cell: "hover shadow", base: 2, target: 24, before: 2, during: [2, 3, 8, 16, 22, 24], blendsBack: true }
    expect(lines(run({ ...hover, after: [23, 18, 10, 4, 2] })).end).toEqual({ name: "end", ok: true, text: "back at 2.000 through 3 frames ✓" })
    expect(lines(run({ ...hover, after: [2, 2, 2] })).end).toEqual({ name: "end", ok: false, text: "switched back to 2.000 ✗ expected a blend back" })
  })
})
