// The Solid 2 binding's browser projects' setup (#209 PR 4b, #257's audit): a test fails on a diagnostic
// Solid 2 only logs.
//
// - Every coded diagnostic its dev build reports, with its attribution engine on, so the codes that
//   need it report too (EFFECT_WRITES_OWN_SOURCE, EFFECT_RELAY_TEAR, UNSTABLE_MEMO_OUTPUT…). The docs
//   say to fix the cause of every code, never suppress one. A reactive read in an effect's apply
//   (STRICT_READ_UNTRACKED), for one: it won't track, so it belongs in the compute, or it's a one-time
//   read and says so with `untrack`.
// - But the timing and size heuristics (`HEURISTICS`), which a loaded machine moves.
// - A hydration key it missed. An element with a template doesn't throw on a miss: Solid warns
//   ("Hydration key miss") and makes a detached copy, leaving the server's node on the page, so a
//   test reading the page can't see it.
// - An error it only logs (#337): one thrown in a memo's comparison, an effect or a handler, which
//   Solid catches and hands to `console.error` without a code. A ward whose target memo threw there
//   stayed at `initial`, and the test passed by every other measure.
import { attribution } from "solid-js/attribution"
import { afterEach, beforeEach, expect } from "vitest"

attribution.enable({ log: false })

/** The codes measured in time, counts or sizes: real costs, but not a test's to judge. */
const HEURISTICS = [
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
]
const CODE = /^\[([A-Z][A-Z_]+)\]/

const logged: Array<string> = []
/** Keep a diagnostic's first line: a code's own report (not its repair guide's), or a hydration key miss. */
const capture = (args: ReadonlyArray<unknown>): void => {
  const message = String(args[0])
  const line = message.split("\n")[0] ?? message
  const code = CODE.exec(line)?.[1]
  const reported = code !== undefined && !HEURISTICS.includes(code) && !line.includes("repair guide") && !line.includes("deeper evidence")
  if (reported || message.includes("Hydration key miss")) logged.push(line)
}
const warn = console.warn.bind(console)
const error = console.error.bind(console)
console.warn = (...args: Array<unknown>): void => {
  capture(args)
  warn(...args)
}
console.error = (...args: Array<unknown>): void => {
  capture(args)
  const thrown = args.find((arg) => arg instanceof Error)
  if (thrown instanceof Error) logged.push(`${thrown.name}: ${thrown.message}`)
  error(...args)
}

beforeEach(() => {
  logged.length = 0
})
afterEach(() => {
  expect(logged, "Solid 2 reported no diagnostic, no hydration key miss and no logged error").toEqual([])
})
