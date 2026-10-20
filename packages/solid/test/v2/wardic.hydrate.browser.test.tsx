// `wardic.<tag>` across a server render and hydration on Solid 2 (#209 PR 4b, ADR-0045). A tag's
// component is made on its first use, inside a render, and cached for the module's life: a server
// makes it on its first request only, a page on every load. Making it must take no hydration id, or
// every later request's keys miss the page's (`Unable to find DOM nodes for hydration key`).
//
// - WH1: the server's second request (its component made), hydrated by a page making it: the
//   element and its sibling are the server's nodes, and nothing failed.
// - WH2: the server's first request (making it), hydrated by a page that made it before: the same.
//
// Every helper and component with a server branch takes the ids on a server that it takes on the
// client (KH1–KH12): each fixture is one of them, then a sibling component whose key follows the ids
// it took. `<AnimatePresence>`'s server branch didn't call `onSettled`, which takes an id on both.
import { wardic } from "@wardic/solid/unstable/v2"
import { commands } from "vitest/browser"
import { afterEach, describe, expect, it } from "vitest"
import * as F from "./hydrate-fixtures.tsx"
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

/**
 * Hydrate `name`, failing on any error hydration throws or reports, and give back which nodes it
 * claimed. A key it missed fails the test too (hydrate-setup.ts): an element with a template
 * doesn't throw on a miss, it warns and makes a detached copy, leaving the server's node on the page.
 */
const hydrated = async (name: string, code: typeof F.W1) => {
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
    const h = await hydrated("W1", F.W1)
    expect(h.claimed("w"), "hydration claimed the server's element").toBe(true)
    expect(h.claimed("after"), "and its sibling").toBe(true)
  })

  it("WH2: a server making the tag's component hydrates in a page that made it before", async () => {
    expect(wardic.address).toBe(wardic.address)
    const h = await hydrated("W2", F.W2)
    expect(h.claimed("w"), "hydration claimed the server's element").toBe(true)
    expect(h.claimed("after"), "and its sibling").toBe(true)
  })
})

describe("each helper's hydration ids", () => {
  const cases = [
    ["KH1", "sensors", "KSensors"],
    ["KH2", "createTransform", "KTransform"],
    ["KH3", "createSpring, createVelocity, createTime", "KSpring"],
    ["KH4", "createScroll", "KScroll"],
    ["KH5", "fromAtom with a server value, streamToSignal", "KAtom"],
    ["KH6", "useWardicFiber", "KFiber"],
    ["KH7", "LayoutGroup, useAnimateLayout", "KLayout"],
    ["KH8", "AnimatePresence", "KPresence"],
    ["KH9", "Reorder.Group and Reorder.Item", "KReorder"],
    ["KH10", "reorderGroup and reorderItem", "KReorderFactories"],
    ["KH11", "a kept ward: spread, ref, read, Provider", "KWard"],
    ["KH12", "wardic.create(Component)", "KCreate"],
  ] as const
  for (const [id, what, name] of cases) {
    it(`${id}: ${what} take the same ids on both sides`, async () => {
      const h = await hydrated(name, F[name])
      expect(h.claimed("after"), "hydration claimed the element after it").toBe(true)
    })
  }
})
