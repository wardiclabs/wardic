// The Solid 2 binding's browser projects' setup (#209 PR 4b): a test fails on a diagnostic Solid 2
// only logs.
//
// - A hydration key it missed. An element with a template doesn't throw on a miss: Solid warns
//   ("Hydration key miss") and makes a detached copy, leaving the server's node on the page, so a
//   test reading the page can't see it.
// - A reactive read in an effect's apply (STRICT_READ_UNTRACKED): it won't track, so either it should
//   be in the compute, or it's a one-time read and says so with `untrack`.
import { afterEach, beforeEach, expect } from "vitest"

const DIAGNOSTICS = ["Hydration key miss", "[STRICT_READ_UNTRACKED]"]

const logged: Array<string> = []
const warn = console.warn.bind(console)
console.warn = (...args: Array<unknown>): void => {
  const message = String(args[0])
  if (DIAGNOSTICS.some((diagnostic) => message.includes(diagnostic))) logged.push(message.split("\n")[0] ?? message)
  warn(...args)
}

beforeEach(() => {
  logged.length = 0
})
afterEach(() => {
  expect(logged, "Solid 2 logged no hydration key miss or untracked read").toEqual([])
})
