// `wardic.<tag>` across a server render and hydration on Solid 2 (#209 PR 4b, ADR-0045). A tag's
// component is made on its first use, inside a render, and cached for the module's life: a server
// makes it on its first request only, a page on every load. Making it must take no hydration id, or
// every later request's keys miss the page's (`Unable to find DOM nodes for hydration key`).
//
// - WH1: the server's second request (its component made), hydrated by a page making it: the
//   element and its sibling are the server's nodes, and nothing failed.
// - WH2: the server's first request (making it), hydrated by a page that made it before: the same.
import { wardic } from "@wardic/solid/unstable/v2"
import { commands } from "vitest/browser"
import { afterEach, describe, expect, it } from "vitest"
import { W1, W2 } from "./hydrate-fixtures.tsx"
import { FIXTURES_FILE, hydrateFixture2 } from "./hydrate.ts"

const errors: Array<string> = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
  e.preventDefault()
}
afterEach(() => {
  window.removeEventListener("error", onError)
  errors.length = 0
})

/** Hydrate `name`, failing on any error hydration throws or reports, and give back which nodes it claimed. */
const hydrated = async (name: string, code: typeof W1) => {
  window.addEventListener("error", onError)
  const h = await hydrateFixture2(name, code)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(errors, "hydration reported no error").toEqual([])
  return h
}

describe("wardic.<tag> hydration keys", () => {
  it("WH1: a server that made the tag's component hydrates in a page making it", async () => {
    const warm = await commands.serverRender2(FIXTURES_FILE, "W1", "W1-warm")
    expect(warm.error).toBe("")
    const h = await hydrated("W1", W1)
    expect(h.claimed("w"), "hydration claimed the server's element").toBe(true)
    expect(h.claimed("after"), "and its sibling").toBe(true)
  })

  it("WH2: a server making the tag's component hydrates in a page that made it before", async () => {
    expect(wardic.address).toBe(wardic.address)
    const h = await hydrated("W2", W2)
    expect(h.claimed("w"), "hydration claimed the server's element").toBe(true)
    expect(h.claimed("after"), "and its sibling").toBe(true)
  })
})
