// What the Solid 2 gate fails on (#209 PR 4b, #257's audit, #320), shared by the binding's browser
// projects (`diagnostics-setup.ts`) and the storefront smoke's dev mode (#460, Q9): every coded
// diagnostic but the heuristics, which a loaded machine moves or which count what a page did.

/**
 * The codes measured in time, counts or sizes: real costs, but not a test's to judge. And
 * `OPTIMISTIC_REVERTED` (#460): an optimistic value the screen showed, then replaced, which Solid's
 * guide calls "a count to read, not a warning to silence". A co-written `createOptimistic(false)`
 * flag, its cheatsheet's "saving…", reports one every time it goes back.
 */
export const HEURISTICS: ReadonlyArray<string> = [
  "HOT_SCOPE_TIME",
  "HOT_SCOPE_RERUNS",
  "HOT_SCOPE_FANOUT",
  "HUGE_FAN_OUT",
  "HUGE_FAN_IN",
  "WIDE_SCOPE_DEPS",
  "GRAPH_GROWTH",
  "SILENT_HOLD",
  "LONG_HOLD",
  "STACKED_HOLDS",
  "FALLBACK_FLASH",
  "ABANDONED_FLIGHTS",
  "ASYNC_WATERFALL",
  "OPTIMISTIC_REVERTED",
]

/** Whether the gate fails on `code`: any but a heuristic. */
export const gated = (code: string): boolean => !HEURISTICS.includes(code)

const CODE = /^\[([A-Z][A-Z_]+)\]/

/** A printed line's code, if it opens with one: `[STRICT_READ_UNTRACKED] …`. */
export const codeOf = (line: string): string | undefined => CODE.exec(line)?.[1]

/** What Solid prints after a code's report, each line opening with the code too. */
const FOLLOW_UPS = ["what it means and how to fix it", "repair guide", "deeper evidence"]

/**
 * Whether a printed line is a code's own report the gate fails on: not a heuristic's, and not one of
 * the lines Solid prints after the report (`FOLLOW_UPS`).
 */
export const reports = (line: string): boolean => {
  const code = codeOf(line)
  return code !== undefined && gated(code) && !FOLLOW_UPS.some((follow) => line.includes(follow))
}
