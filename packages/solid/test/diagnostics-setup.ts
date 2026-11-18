// The Solid 2 binding's browser projects' setup (#209 PR 4b, #257's audit, #320): a test fails on a
// diagnostic Solid 2 only reports.
//
// - Every coded diagnostic its dev build reports, with its attribution engine on, so the codes that
//   need it report too (EFFECT_WRITES_OWN_SOURCE, EFFECT_RELAY_TEAR, UNSTABLE_MEMO_OUTPUT…). The docs
//   say to fix the cause of every code, never suppress one. A reactive read in an effect's apply
//   (STRICT_READ_UNTRACKED), for one: it won't track, so it belongs in the compute, or it's a one-time
//   read and says so with `untrack`.
// - Read from its diagnostics channel (`OBSERVE.diagnostics`), at every severity, and from the console.
//   Solid prints only a `warn` or an `error`: a relay across more than one effect, a relay's tear
//   (EFFECT_RELAY_TEAR) and every other `info` code reach the channel alone. Read from the console
//   only, 73 tests made one unseen (#320).
// - But the timing and size heuristics (`HEURISTICS`, `./gate-filter.ts`, which the storefront smoke's
//   dev mode shares), which a loaded machine moves.
// - But a code a test makes on purpose, named with `allowDiagnostic` (`./diagnostics.ts`).
// - A hydration key it missed. An element with a template doesn't throw on a miss: Solid warns
//   ("Hydration key miss") and makes a detached copy, leaving the server's node on the page, so a
//   test reading the page can't see it.
// - An error it only logs (#337): one thrown in a memo's comparison, an effect or a handler, which
//   Solid catches and hands to `console.error` without a code. A ward whose target memo threw there
//   stayed at `initial`, and the test passed by every other measure.
//
// What it prints is what the gate fails on: a heuristic's report, and a code the test allows, are
// heard (the channel's events, and `allowed`'s check) but not printed, so CI's log holds only what a
// reader should act on. Solid's attribution engine still has every heuristic (`costs()`, `feedback()`).
import { OBSERVE } from "solid-js"
import { attribution } from "solid-js/attribution"
import { afterEach, beforeEach, expect } from "vitest"
import { gateState } from "./diagnostics.ts"
import { codeOf, gated, reports } from "./gate-filter.ts"

attribution.enable({ log: false })

const { allowed, seen } = gateState
/** Keep a diagnostic once, by its first line: a printed one reaches the channel too. */
const keep = (code: string | undefined, line: string): void => {
  if (seen.some((s) => s.line === line)) return
  seen.push({ code, line })
}

// The channel: every coded diagnostic, at every severity.
if (OBSERVE === undefined) throw new Error("diagnostics-setup: Solid 2's dev build has no OBSERVE channel")
OBSERVE.diagnostics.subscribe((event) => {
  if (!gated(event.code)) return
  keep(event.code, event.message.split("\n")[0] ?? event.message)
})

/** A console call's first line. */
const firstLineOf = (args: ReadonlyArray<unknown>): string => {
  const message = String(args[0])
  return message.split("\n")[0] ?? message
}

/** The console: a code's own report (not its repair guide's), or a hydration key miss. */
const capture = (args: ReadonlyArray<unknown>): void => {
  const line = firstLineOf(args)
  if (reports(line) || String(args[0]).includes("Hydration key miss")) keep(codeOf(line), line)
}

/**
 * Whether a console call is a code the gate leaves be, its report or one of the lines after it: a
 * heuristic's, or one the test makes on purpose (`allowDiagnostic`). Not printed.
 */
const quiet = (args: ReadonlyArray<unknown>): boolean => {
  const code = codeOf(firstLineOf(args))
  if (code === undefined) return false
  return !gated(code) || allowed.has(code)
}

const warn = console.warn.bind(console)
const error = console.error.bind(console)
console.warn = (...args: Array<unknown>): void => {
  capture(args)
  if (quiet(args)) return
  warn(...args)
}
console.error = (...args: Array<unknown>): void => {
  capture(args)
  const thrown = args.find((arg) => arg instanceof Error)
  if (thrown instanceof Error) keep(undefined, `${thrown.name}: ${thrown.message}`)
  if (quiet(args)) return
  error(...args)
}

beforeEach(() => {
  seen.length = 0
  allowed.clear()
})
afterEach(() => {
  const reported = seen.filter((s) => s.code === undefined || !allowed.has(s.code)).map((s) => s.line)
  expect(reported, "Solid 2 reported no diagnostic, no hydration key miss and no logged error").toEqual([])
})
