// `createBatch` on Solid 2's server (#665's PR 6, ADR-0070 decision 14, Q63–Q67): Solid 1's
// (`../create-batch.ssr.test.tsx`), the start each spread member renders.
//
// - CBVS1: by index, a member's start over its own `style`, less the properties the Batch draws, as the
//   DOM writer draws it; `initial: false`, its targets; none, nothing.
// - CBVS2: keyed, by its item and index; a key the list doesn't have renders none; under
//   `<AnimatePresence initial={false}>`, the targets.
// - CBVS3: a string `style`, and a start that isn't a number, are the client's errors.
import { AnimatePresence, createBatch } from "@wardic/solid/unstable/v2"
import { For } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr.ts"

/** The tag whose `data-k` is `k`. */
const tagOf = (html: string, k: string) => tagsOf(html).find((t) => t.attrs["data-k"] === k)

describe("createBatch's server render on Solid 2 (#665)", () => {
  it("CBVS1: by index, a member's start over its own style; initial false, its targets; none, nothing", () => {
    const html = serve(() => {
      const grid = createBatch({ count: 2, initial: { x: 10, opacity: 0 }, animate: (i) => ({ x: i * 10, opacity: 1 }) })
      const quiet = createBatch({ count: 2, initial: false, animate: (i) => ({ y: i * 20 }) })
      const none = createBatch({ count: 1, animate: () => ({ x: 50 }) })
      return (
        <>
          <div data-k="a" {...grid.at(0, { style: { background: "teal", opacity: 0.5 } })} />
          <div data-k="q1" {...quiet.at(1)} />
          <div data-k="none" {...none.at(0)} />
        </>
      )
    })
    expect(tagOf(html, "a")?.style).toEqual({ background: "teal", transform: "translateX(10px)", opacity: "0" })
    expect(tagOf(html, "q1")?.style).toEqual({ transform: "translateY(20px)" })
    expect(tagOf(html, "none")?.style).toEqual({})
  })

  it("CBVS2: keyed, by its item and index; an unlisted key renders none; initial={false} on a presence, the targets", () => {
    const items = [{ id: "a", n: 1 }, { id: "b", n: 2 }]
    const html = serve(() => {
      const list = createBatch({ each: () => items, key: "id", initial: (item) => ({ scale: item.n }), animate: () => ({ scale: 1 }) })
      const quiet = createBatch({ each: () => items, key: "id", initial: { opacity: 0 }, animate: (_, i) => ({ x: i * 30, opacity: 1 }) })
      return (
        <>
          <For each={items}>{(item) => <div data-k={`l-${item.id}`} {...list.member(item.id)} />}</For>
          <div data-k="l-z" {...list.member("z")} />
          <AnimatePresence initial={false}>
            <For each={items}>{(item) => <div data-k={`q-${item.id}`} {...quiet.member(item.id)} />}</For>
          </AnimatePresence>
        </>
      )
    })
    expect(tagOf(html, "l-a")?.style).toEqual({})
    expect(tagOf(html, "l-b")?.style).toEqual({ transform: "scale(2)" })
    expect(tagOf(html, "l-z")?.style).toEqual({})
    expect(tagOf(html, "q-a")?.style).toEqual({})
    expect(tagOf(html, "q-b")?.style).toEqual({ transform: "translateX(30px)" })
  })

  it("CBVS3: a string style, and a start that isn't a number, are the client's errors", () => {
    expect(() =>
      serve(() => {
        const grid = createBatch({ count: 1, animate: () => ({ x: 0 }) })
        return <div {...grid.at(0, { style: "color: red" as never })} />
      })).toThrow(/give a member's own `style` as an object/)
    expect(() =>
      serve(() => {
        const grid = createBatch({ count: 1, initial: { x: "10px" as never }, animate: () => ({ x: 0 }) })
        return <div {...grid.at(0)} />
      })).toThrow(/member 0's "x" starts at "10px": a Batch's values are numbers/)
  })
})
