// The v2-hydrate project's setup (#209 PR 4b): every test fails on a hydration key Solid 2 missed.
// An element with a template doesn't throw on a miss: Solid warns ("Hydration key miss") and makes
// a detached copy, leaving the server's node on the page, so a test reading the page can't see it.
// The warnings are counted here, from every hydration a test runs, and must be none.
import { afterEach, beforeEach, expect } from "vitest"

const misses: Array<string> = []
const warn = console.warn.bind(console)
console.warn = (...args: Array<unknown>): void => {
  if (String(args[0]).includes("Hydration key miss")) misses.push(String(args[0]))
  warn(...args)
}

beforeEach(() => {
  misses.length = 0
})
afterEach(() => {
  expect(misses, "hydration missed no key").toEqual([])
})
