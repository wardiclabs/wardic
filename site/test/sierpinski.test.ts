// The Sierpiński sample's placement (#665's PR 7, Q20, Q75 S1): each of its 2,187 leaves sits on its
// ancestor at the slider's depth, its top-left corner where that triangle's is, scaled to its size. A
// triangle's three halves: its top one is centred across it, its left and right ones under it.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { HEIGHT, LEAVES, leafAt, WIDTH } from "../samples/sierpinski/triangle.ts"

/** `leaf`'s placement, each value to a millionth of a pixel. */
const near = (leaf: { readonly x: number; readonly y: number; readonly scale: number }, x: number, y: number, scale: number): void => {
  expect(leaf.x).toBeCloseTo(x, 6)
  expect(leaf.y).toBeCloseTo(y, 6)
  expect(leaf.scale).toBeCloseTo(scale, 6)
}

describe("the Sierpiński sample's leaves (#665)", () => {
  it("SP1: 3^7 leaves, every one on the whole triangle at depth 0", () => {
    expect(LEAVES).toBe(2187)
    near(leafAt(0, 0), 0, 0, 1)
    near(leafAt(1500, 0), 0, 0, 1)
    near(leafAt(2186, 0), 0, 0, 1)
  })

  it("SP2: at depth 1, a leaf's first third of the leaves picks the top, left or right half", () => {
    // The first 729 leaves are the top half's, centred across the top.
    near(leafAt(0, 1), WIDTH / 4, 0, 1 / 2)
    near(leafAt(728, 1), WIDTH / 4, 0, 1 / 2)
    // The next 729, the bottom-left's.
    near(leafAt(729, 1), 0, HEIGHT / 2, 1 / 2)
    // The last 729, the bottom-right's.
    near(leafAt(1458, 1), WIDTH / 2, HEIGHT / 2, 1 / 2)
    near(leafAt(2186, 1), WIDTH / 2, HEIGHT / 2, 1 / 2)
  })

  it("SP3: at depth 2, the bottom-right half's left quarter", () => {
    // 1701 = 2 × 729 + 1 × 243: right, then left.
    near(leafAt(1701, 2), WIDTH / 2, (3 * HEIGHT) / 4, 1 / 4)
  })

  it("SP4: at depth 7, each leaf is its own triangle: the corners' at the whole one's corners", () => {
    // The top leaf, 1/128 of the width, centred on the apex.
    near(leafAt(0, 7), WIDTH / 2 - WIDTH / 256, 0, 1 / 128)
    // The bottom-left leaf, at the bottom-left corner.
    near(leafAt(1093, 7), 0, HEIGHT - HEIGHT / 128, 1 / 128)
    // The bottom-right leaf, its right edge on the right corner.
    near(leafAt(2186, 7), WIDTH - WIDTH / 128, HEIGHT - HEIGHT / 128, 1 / 128)
  })

  it("SP5: the guide shows triangle.ts's leafAt as it is", () => {
    const read = (path: string): string => readFileSync(join(import.meta.dirname, "..", path), "utf8")
    // From `export const leafAt` to the function's closing brace, alone on its line.
    const leafAtIn = (text: string): string => {
      const start = text.indexOf("export const leafAt")
      return text.slice(start, text.indexOf("\n}\n", start) + 2)
    }
    const shown = leafAtIn(read("src/content/guides/batches.mdx"))
    expect(shown.startsWith("export const leafAt")).toBe(true)
    expect(shown).toBe(leafAtIn(read("samples/sierpinski/triangle.ts")))
  })
})
