// `createBatch` from a server render to hydration on Solid 2 (#665's PR 6, ADR-0070 decision 14,
// Q63–Q68): Solid 1's (`../create-batch.hydrate.browser.test.tsx`), the server's markup on the page a few
// frames before hydration, as a page's JS comes later.
//
// - HB1: by index, entering from `initial`: every frame before hydration shows the server's start; once
//   hydrated, its members move frame for frame as a client render's do, from that start to their targets.
// - HB2: `initial: false`: every frame, before hydration and after it, shows the targets: nothing moves.
// - HB3: keyed, by item and index, frame for frame with a client render; under `<AnimatePresence
//   initial={false}>`, at the targets throughout.
import { render } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { describe, expect, it } from "vitest"
import { over } from "../browser-helpers.ts"
import { B1, B2, B3 } from "./batch-hydrate-fixtures.tsx"
import { hydrateFixture2 } from "./hydrate.ts"

const FILE = "./test/v2/batch-hydrate-fixtures.tsx"

/** What an element draws: its `x`, `y`, scale and opacity, and its width. */
const drawnOf = (el: Element): ReadonlyArray<number> => {
  const computed = getComputedStyle(el)
  const m = new DOMMatrix(computed.transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  // Its own style's width too, which the server's markup keeps beside its start.
  return [m.m41, m.m42, m.a, Number(computed.opacity), (el as HTMLElement).offsetWidth]
}

/** What each of `ks`' elements under `host` draws. */
const readAll = (host: ParentNode, ks: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<number>> =>
  ks.map((k) => drawnOf(host.querySelector(`[data-k="${k}"]`) as Element))

/** Hydrate fixture `name` after `waitFrames` frames of its server markup, recording them; then a client render beside it, both read for `frames` frames. */
const run = async (name: string, code: () => ReturnType<typeof B1>, ks: ReadonlyArray<string>, frames: number) => {
  let before: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> = []
  const errors: Array<string> = []
  const logged = console.error
  console.error = (...args: ReadonlyArray<unknown>) => void errors.push(args.map(String).join(" "))
  try {
    const hydrated = await hydrateFixture2(name, code, {
      file: FILE,
      waiting: async (host) => {
        before = await over(5, () => readAll(host, ks))
      },
    })
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(code, host)
    const after = await over(frames, () => [readAll(hydrated.host, ks), readAll(host, ks)] as const)
    const claimed = ks.every((k) => hydrated.claimed(k))
    hydrated.dispose()
    dispose()
    host.remove()
    return { before, after, errors, threw: Bool.match(claimed, { onTrue: () => "", onFalse: () => "not claimed" }) }
  } finally {
    console.error = logged
  }
}

/** Each frame's hydrated members as the client render's, within 1e-6. */
const expectSame = (after: ReadonlyArray<readonly [ReadonlyArray<ReadonlyArray<number>>, ReadonlyArray<ReadonlyArray<number>>]>): void =>
  after.forEach(([hydrated, client], f) =>
    hydrated.forEach((member, n) => member.forEach((value, j) => expect(value, `frame ${f}, member ${n}, value ${j}`).toBeCloseTo(client[n][j], 6))))

describe("createBatch from a server render to hydration on Solid 2 (#665)", () => {
  it("HB1: by index: the server's start until hydration, then a client render's move, frame for frame", async () => {
    const { before, after, errors, threw } = await run("B1", B1, ["m0", "m1", "m2"], 30)
    expect([threw, errors]).toEqual(["", []])
    before.forEach((frame) => expect(frame).toEqual([[0, 20, 1, 0, 20], [0, 20, 1, 0, 20], [0, 20, 1, 0, 20]]))
    expectSame(after)
    expect(after[0][0][1][1], "it moved from the server's start, not before it").toBeGreaterThan(10)
    expect(after[after.length - 1][0]).toEqual([[0, 0, 1, 1, 20], [50, 0, 1, 1, 20], [100, 0, 1, 1, 20]])
  })

  it("HB2: initial false: the targets throughout, before hydration and after it", async () => {
    const { before, after, errors, threw } = await run("B2", B2, ["m0", "m1", "m2"], 12)
    expect([threw, errors]).toEqual(["", []])
    const targets = [[0, 0, 1, 1, 20], [50, 0, 1.1, 1, 20], [100, 0, 1.2, 1, 20]]
    before.forEach((frame) => frame.forEach((member, n) => member.forEach((value, j) => expect(value).toBeCloseTo(targets[n][j], 6))))
    after.forEach(([hydrated]) => hydrated.forEach((member, n) => member.forEach((value, j) => expect(value).toBeCloseTo(targets[n][j], 6))))
  })

  it("HB3: keyed, by item and index, frame for frame with a client render; initial={false} on a presence, the targets", async () => {
    const { before, after, errors, threw } = await run("B3", B3, ["l-a", "l-b", "q-a", "q-b"], 30)
    expect([threw, errors]).toEqual(["", []])
    before.forEach((frame) => expect(frame).toEqual([[-20, 0, 1, 0, 20], [-40, 0, 1, 0, 20], [0, 0, 1, 1, 20], [30, 0, 1, 1, 20]]))
    expectSame(after)
    after.forEach(([hydrated]) => expect(hydrated.slice(2)).toEqual([[0, 0, 1, 1, 20], [30, 0, 1, 1, 20]]))
    // `x`, which only `initial` gives, stays where it started, as on a client render.
    expect(after[after.length - 1][0].slice(0, 2)).toEqual([[-20, 0, 1, 1, 20], [-40, 30, 1, 1, 20]])
  })
})
