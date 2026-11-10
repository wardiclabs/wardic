// `createBatch` on Solid 1's server and in its types (#665).
//
// - CBS1: its targets take the transforms and `opacity` as numbers, and nothing else; its transition
//   takes a `stagger()` delay.
// - CBS2: on the server a member's element renders with its own props, and nothing of the Batch's.
import { createBatch, stagger, type WardicBatchConfig, type WardicBatchValues } from "@wardic/solid"
import { describe, expect, expectTypeOf, it } from "vitest"
import { serve, tagsOf } from "./ssr-helpers.ts"

describe("createBatch's types and server render (#665)", () => {
  it("CBS1: its targets take the transforms and opacity as numbers, and nothing else", () => {
    expectTypeOf<{ readonly x: 1; readonly rotateY: 2; readonly scale: 1.5; readonly opacity: 0.5 }>().toExtend<WardicBatchValues>()
    // @ts-expect-error a Batch draws the transforms and opacity alone
    const width: WardicBatchValues = { width: 10 }
    // @ts-expect-error a Batch's values are numbers
    const percent: WardicBatchValues = { x: "50%" }
    void width
    void percent
    const config: WardicBatchConfig = { count: 3, animate: (i) => ({ x: i * 10 }), transition: { type: "spring", bounce: 0.2, delay: stagger(0.01) } }
    void config
  })

  it("CBS2: on the server a member's element renders with its own props, and nothing of the Batch's", () => {
    const html = serve(() => {
      const grid = createBatch({ count: 2, initial: { opacity: 0 }, animate: (i) => ({ x: i * 10, opacity: 1 }) })
      return (
        <>
          <div data-k="a" {...grid.at(0, { style: { background: "teal" } })} />
          <div data-k="b" {...grid.at(1)} />
        </>
      )
    })
    const tags = tagsOf(html)
    expect(tags.find((t) => t.attrs["data-k"] === "a")?.style).toEqual({ background: "teal" })
    expect(tags.find((t) => t.attrs["data-k"] === "b")?.style).toEqual({})
  })
})
