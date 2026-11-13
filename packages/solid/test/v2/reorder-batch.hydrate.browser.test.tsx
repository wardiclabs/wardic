// `Reorder.BatchGroup` from a server render to hydration on Solid 2 (#712's PR 3, Q37, Q39): Solid 1's HR1
// (`reorder-batch.hydrate.browser.test.tsx`), the server's markup on the page a few frames first.
//
// - HR1: a column, a grid with no `columns` (CSS grid on the server, its places once hydrated) and a row
//   right to left: every item where it is in its group, frame for frame, before hydration and after it;
//   each element the server's, claimed, with nothing logged.
// - HR2: padded groups, a grid fading in from `initial` and a column: every item where it is, inside the
//   padding; the grid's items at `initial`'s opacity until hydrated.
// - HR4 (#714): items each their own size, a function's: a padded column, a grid of rows (`flex-wrap` on the
//   server, its places once hydrated), and a padded column whose items take its width (`100cqi`): every item
//   where it is, its own size, before and after.
import * as Bool from "effect/Boolean"
import { describe, expect, it } from "vitest"
import { over } from "../browser-helpers.ts"
import { R1, R10, R2, R3, R4, R5, R8, R9 } from "./reorder-batch-hydrate-fixtures.tsx"
import { hydrateFixture2 } from "./hydrate.ts"

const FILE = "./test/v2/reorder-batch-hydrate-fixtures.tsx"
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
  const errors: Array<string> = []
  const logged = console.error
  console.error = (...args: ReadonlyArray<unknown>) => void errors.push(args.map(String).join(" "))
  try {
    const hydrated = await hydrateFixture2(name, code, {
      file: FILE,
      waiting: async (host) => {
        before = await over(4, () => placesIn(host))
        fadedBefore = await over(1, () => opacitiesIn(host))
      },
    })
    const after = await over(12, () => placesIn(hydrated.host))
    const claimed = KS.every((k) => hydrated.claimed(k))
    hydrated.dispose()
    return { before, after, errors, fadedBefore, threw: Bool.match(claimed, { onTrue: () => "", onFalse: () => "not claimed" }) }
  } finally {
    console.error = logged
  }
}

describe("Reorder.BatchGroup from a server render to hydration on Solid 2 (#712)", () => {
  it("HR1: a column, a grid from its width, an rtl row: each item where it is, before hydration and after it", async () => {
    const expected: Record<string, ReadonlyArray<string>> = {
      R1: KS.map((k, i) => `${k} 0,${i * 60} 80x50`),
      R2: KS.map((k, i) => `${k} ${(i % 3) * 90},${Math.floor(i / 3) * 60} 80x50`),
      R3: KS.map((k, i) => `${k} ${360 - i * 90},0 80x50`),
    }
    for (const [name, code] of [["R1", R1], ["R2", R2], ["R3", R3]] as const) {
      const { before, after, errors, threw } = await run(name, code)
      expect([threw, errors], `${name}: claimed, nothing logged`).toEqual(["", []])
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
      expect([threw, errors], `${name}: claimed, nothing logged`).toEqual(["", []])
      before.forEach((frame, f) => expect(frame, `${name}: before hydration, frame ${f}`).toEqual(expected[name]))
      after.forEach((frame, f) => expect(frame, `${name}: hydrated, frame ${f}`).toEqual(expected[name]))
      if (name === "R4") expect(fadedBefore[0], "R4: at initial's opacity on the server").toEqual([0, 0, 0, 0, 0])
    }
  }, 60_000)

  it("HR4: items each their own size: a padded column, a grid of rows, a column of the group's width: each where it is", async () => {
    const expected: Record<string, ReadonlyArray<string>> = {
      R8: ["a 12,12 200x40", "b 12,62 200x70", "c 12,142 200x50", "d 12,202 200x90", "e 12,302 200x60"],
      // 280 px: a, b and c fill the first row to its edge; d and e start the second, below b's 70.
      R9: ["a 0,0 80x40", "b 90,0 120x70", "c 220,0 60x50", "d 0,80 100x90", "e 110,80 40x60"],
      // Inside the padding, its content box's width, before hydration as after.
      R10: KS.map((k, i) => `${k} 12,${12 + i * 60} 300x50`),
    }
    for (const [name, code] of [["R8", R8], ["R9", R9], ["R10", R10]] as const) {
      const { before, after, errors, threw } = await run(name, code)
      expect([threw, errors], `${name}: claimed, nothing logged`).toEqual(["", []])
      before.forEach((frame, f) => expect(frame, `${name}: before hydration, frame ${f}`).toEqual(expected[name]))
      after.forEach((frame, f) => expect(frame, `${name}: hydrated, frame ${f}`).toEqual(expected[name]))
    }
  }, 60_000)
})

