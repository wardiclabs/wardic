// What a page's <Demo> runs (#665's PR 7, Q24): a sample's `demo.tsx` when it has one, its page's own
// wrapping of the sample (Sierpiński's "One Batch / A ward each" toggle), else its Solid 2 file.
import { describe, expect, it } from "vitest"
import { demoFileOf } from "../src/components/demo-file.ts"

/** A sample folder holding `files`, as the Demo's glob of the samples would. */
const holding =
  (...files: ReadonlyArray<string>) =>
  (path: string): boolean =>
    files.includes(path)

describe("a Demo's file (#665)", () => {
  it("DM1: a sample with a demo.tsx runs it, not its Solid 2 file", () => {
    const has = holding("../../samples/sierpinski/demo.tsx", "../../samples/sierpinski/solid2.tsx")
    expect(demoFileOf("sierpinski", has)).toBe("../../samples/sierpinski/demo.tsx")
  })

  it("DM2: a sample with only its binding files runs its Solid 2 file", () => {
    const has = holding("../../samples/reorder/solid1.tsx", "../../samples/reorder/solid2.tsx", "../../samples/reorder/motion.tsx")
    expect(demoFileOf("reorder", has)).toBe("../../samples/reorder/solid2.tsx")
  })

  it("DM3: a sample with neither has no demo", () => {
    const has = holding("../../samples/notes/solid1.tsx")
    expect(demoFileOf("notes", has)).toBeUndefined()
  })
})
