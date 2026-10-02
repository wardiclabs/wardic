/**
 * Scenario 15's board (#47, ADR-0022): each cell is one way a key with no value gets a Base
 * value, and each gesture on a cell is one run, judged on two lines:
 *
 * - **start**: where the painted value starts. A gesture's (hover, press) and an exit's
 *   first frame that moved off the value before it lies within a quarter of the way from
 *   the base to the target (0.02 at least), so a start from 0 or a jump to the target
 *   fails. A mount's first frame does the same. A style change at rest shows the new value
 *   within three frames.
 * - **end**: where it ends. A gesture is back at its base (within 0.005); a mount settles at
 *   its target; an exit fades through (a frame strictly between its base and its target)
 *   before the node goes; a style change is still at it.
 *
 * Pure (no DOM), so the node test tier imports it (`test/base-values-board.test.ts`).
 *
 * @module
 */

/** What a run is: a gesture (hover, press), a mount, an exit or a style change at rest. */
export type BoardRunKind = "gesture" | "mount" | "exit" | "style change"

/** One gesture on one cell, as the board's recorder sampled it. */
export interface BoardRunInput {
  readonly scenarioId: string
  /** The cell's label, e.g. `hover scale`. */
  readonly cell: string
  readonly kind: BoardRunKind
  /** Where the value should start (and, for a gesture, end): the key's Base value. */
  readonly base: number
  /** Where the gesture takes it. */
  readonly target: number
  /** The painted value just before the gesture; `NaN` before a mount. */
  readonly before: number
  /** The painted value each frame from the gesture's start until it ends (the leave, the release, the node's removal). */
  readonly during: ReadonlyArray<number>
  /** Each frame after it ends, until the value stood still. */
  readonly after: ReadonlyArray<number>
  /** When the run started and ended (`performance.now()`, ms). */
  readonly startedAt: number
  readonly endedAt: number
}

/** The card's lines, in display order. */
export const BOARD_CHECK_NAMES = ["start", "end"] as const

/** One card line. */
export interface BoardCheck {
  readonly name: (typeof BOARD_CHECK_NAMES)[number]
  readonly ok: boolean
  readonly text: string
}

const v3 = (v: number | undefined): string => (v === undefined || Number.isNaN(v) ? "?" : v.toFixed(3))
const line = (name: BoardCheck["name"], ok: boolean, value: string, expected: string): BoardCheck => ({
  name,
  ok,
  text: ok ? `${value} ✓` : `${value} ✗ expected ${expected}`,
})

/** The first frame that moved off `before` (a mount's first frame). */
const firstMovedOf = (input: BoardRunInput): number | undefined =>
  Number.isNaN(input.before) ? input.during[0] : input.during.find((v) => Math.abs(v - input.before) > 0.002)

const startOf = (input: BoardRunInput): BoardCheck => {
  if (input.kind === "style change") {
    const shown = input.during.slice(0, 3).find((v) => Math.abs(v - input.base) <= 0.005)
    const seen = shown ?? input.during[Math.min(2, input.during.length - 1)]
    return line("start", shown !== undefined, `shows ${v3(seen)}`, `${input.base} within 3 frames`)
  }
  const first = firstMovedOf(input)
  const tolerance = Math.max(0.25 * Math.abs(input.target - input.base), 0.02)
  const ok = first !== undefined && Math.abs(first - input.base) <= tolerance
  return line("start", ok, `from ${v3(first)} (base ${input.base})`, `within ${Number(tolerance.toFixed(3))} of ${input.base}`)
}

const endOf = (input: BoardRunInput): BoardCheck => {
  const all = [...input.during, ...input.after]
  const last = all[all.length - 1]
  switch (input.kind) {
    case "gesture": {
      const ok = last !== undefined && Math.abs(last - input.base) <= 0.005
      return ok ? line("end", true, `back at ${v3(last)}`, "") : line("end", false, `at ${v3(last)}`, `back at ${input.base}`)
    }
    case "mount": {
      const ok = last !== undefined && Math.abs(last - input.target) <= 0.005
      return ok ? line("end", true, `settled at ${v3(last)}`, "") : line("end", false, `at ${v3(last)}`, `settled at ${input.target}`)
    }
    case "exit": {
      const lo = Math.min(input.base, input.target) + 0.05
      const hi = Math.max(input.base, input.target) - 0.05
      const ok = input.during.some((v) => v > lo && v < hi)
      return line("end", ok, ok ? "faded out" : "vanished", `a fade from ${input.base}`)
    }
    case "style change": {
      const ok = last !== undefined && Math.abs(last - input.base) <= 0.005
      return line("end", ok, `at ${v3(last)}`, `${input.base}`)
    }
  }
}

/** A run's two lines (see the module doc). */
export const boardChecksOf = (input: BoardRunInput): Array<BoardCheck> => [startOf(input), endOf(input)]
