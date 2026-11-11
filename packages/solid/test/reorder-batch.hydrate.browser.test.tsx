// `Reorder.BatchGroup` from a server render to hydration on Solid 1 (#712's PR 3, Q37, Q39): the server's
// markup is on the page a few frames before hydration, as a page's JS comes later.
//
// - HR1: a column, a grid with no `columns` (CSS grid on the server, its places once hydrated) and a row
//   right to left: every item where it is in its group, frame for frame, before hydration and after it;
//   each hydrates with nothing thrown or logged.
// - HR2: padded groups, a grid from its width fading in from `initial` and a column: every item where it is,
//   inside the padding, before and after; the grid's items at `initial`'s opacity until hydrated.
import { describe, expect, it } from "vitest"
import { over } from "./browser-helpers.ts"
import { R1, R2, R3, R4, R5 } from "./reorder-batch-hydrate-fixtures.tsx"
import { hydrateFixture } from "./hydrate-harness.ts"
import "./browser-commands.ts"

const FILE = "./test/reorder-batch-hydrate-fixtures.tsx"
const KS = ["a", "b", "c", "d", "e"]

/** Each item's box from its group's top-left, rounded. */
const placesIn = (host: ParentNode): ReadonlyArray<string> => {
  const group = host.querySelector("ul") as HTMLElement
  const g = group.getBoundingClientRect()
  return KS.map((k) => {
    const b = (host.querySelector(`[data-k="${k}"]`) as HTMLElement).getBoundingClientRect()
    return `${k} ${Math.round(b.left - g.left)},${Math.round(b.top - g.top)} ${Math.round(b.width)}x${Math.round(b.height)}`
  })
}

/** Each item's drawn opacity. */
const opacitiesIn = (host: ParentNode): ReadonlyArray<number> => KS.map((k) => Number(getComputedStyle(host.querySelector(`[data-k="${k}"]`) as HTMLElement).opacity))

const run = async (name: string, code: () => ReturnType<typeof R1>) => {
  let before: ReadonlyArray<ReadonlyArray<string>> = []
  let fadedBefore: ReadonlyArray<ReadonlyArray<number>> = []
  const hydrated = await hydrateFixture(name, code, {
    file: FILE,
    waiting: async (host) => {
      before = await over(4, () => placesIn(host))
      fadedBefore = await over(1, () => opacitiesIn(host))
    },
  })
  const after = await over(12, () => placesIn(hydrated.host))
  const errors = hydrated.stopErrors()
  const threw = hydrated.threw
  hydrated.dispose()
  return { before, after, errors, threw, fadedBefore }
}

describe("Reorder.BatchGroup from a server render to hydration on Solid 1 (#712)", () => {
  it("HR1: a column, a grid from its width, an rtl row: each item where it is, before hydration and after it", async () => {
    const expected: Record<string, ReadonlyArray<string>> = {
      R1: KS.map((k, i) => `${k} 0,${i * 60} 80x50`),
      // 300 px holds three places a row.
      R2: KS.map((k, i) => `${k} ${(i % 3) * 90},${Math.floor(i / 3) * 60} 80x50`),
      R3: KS.map((k, i) => `${k} ${360 - i * 90},0 80x50`),
    }
    for (const [name, code] of [["R1", R1], ["R2", R2], ["R3", R3]] as const) {
      const { before, after, errors, threw } = await run(name, code)
      expect([threw, errors], `${name}: nothing thrown or logged`).toEqual(["", []])
      before.forEach((frame, f) => expect(frame, `${name}: before hydration, frame ${f}`).toEqual(expected[name]))
      after.forEach((frame, f) => expect(frame, `${name}: hydrated, frame ${f}`).toEqual(expected[name]))
    }
  }, 60_000)

  it("HR2: padded groups, a grid fading in from initial and a column: every item where it is, inside the padding", async () => {
    const expected: Record<string, ReadonlyArray<string>> = {
      R4: KS.map((k, i) => `${k} ${12 + (i % 3) * 90},${12 + Math.floor(i / 3) * 60} 80x50`),
      R5: KS.map((k, i) => `${k} 12,${12 + i * 60} 80x50`),
    }
    for (const [name, code] of [["R4", R4], ["R5", R5]] as const) {
      const { before, after, errors, threw, fadedBefore } = await run(name, code)
      expect([threw, errors], `${name}: nothing thrown or logged`).toEqual(["", []])
      before.forEach((frame, f) => expect(frame, `${name}: before hydration, frame ${f}`).toEqual(expected[name]))
      after.forEach((frame, f) => expect(frame, `${name}: hydrated, frame ${f}`).toEqual(expected[name]))
      if (name === "R4") expect(fadedBefore[0], "R4: at initial's opacity on the server").toEqual([0, 0, 0, 0, 0])
    }
  }, 60_000)
})
