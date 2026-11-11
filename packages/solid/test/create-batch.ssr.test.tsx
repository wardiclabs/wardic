// `createBatch` on Solid 1's server and in its types (#665).
//
// - CBS1: its targets take the transforms and `opacity` as numbers, and nothing else; its transition
//   takes a `stagger()` delay.
// - CBS2: on the server a spread member renders its start (#665's PR 6, Q63): its `initial`'s values, as
//   the DOM writer's own `transform` and `opacity` strings, over its own `style`, less the properties the
//   Batch draws; a key at its identity writes nothing.
// - CBS3: `initial` as a function of the index; `initial: false`, the targets; no `initial`, nothing.
// - CBS4: keyed (Q65): each member's start by its item and its index in the list; a key the list
//   doesn't have renders none; under `<AnimatePresence initial={false}>`, the targets.
// - CBS5: a handle given to `ref` alone renders nothing of the Batch's.
// - CBS6: the client's errors are thrown on the server, with its messages (Q67): a string `style`, a
//   start that isn't a number, a target that isn't one, a start outside a keyed Batch's `keys`, two
//   items with one key.
import * as DomBatch from "@wardic/dom/DomBatch"
import { AnimatePresence, createBatch, stagger, type WardicBatchConfig, type WardicBatchValues } from "@wardic/solid"
import { For } from "solid-js"
import { describe, expect, expectTypeOf, it } from "vitest"
import { serve, tagsOf } from "./ssr-helpers.ts"

/** The style the DOM writer draws `values` with, written into a stand-in element: what the server must write. */
const writerStyleOf = (keys: ReadonlyArray<string>, values: ReadonlyArray<number>): Record<string, string> => {
  const drawn: Record<string, string> = {}
  const el = { style: { setProperty: (name: string, value: string) => void (drawn[name] = value) } } as unknown as Element
  DomBatch.writer.forKeys(keys)(el, Float64Array.from(values), 0)
  return drawn
}

/** The tag whose `data-k` is `k`. */
const tagOf = (html: string, k: string) => tagsOf(html).find((t) => t.attrs["data-k"] === k)

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

  it("CBS2: on the server a spread member renders its start, the DOM writer's own strings, over its own style", () => {
    const html = serve(() => {
      const grid = createBatch({ count: 2, initial: { x: 10, rotate: 45, opacity: 0 }, animate: (i) => ({ x: i * 10, rotate: 0, opacity: 1 }) })
      return (
        <>
          <div data-k="a" {...grid.at(0, { style: { background: "teal", transform: "scale(2)", opacity: 0.5 } })} />
          <div data-k="b" {...grid.at(1)} />
        </>
      )
    })
    const written = writerStyleOf(["x", "rotate", "opacity"], [10, 45, 0])
    expect(tagOf(html, "a")?.style).toEqual({ background: "teal", ...written })
    expect(tagOf(html, "b")?.style).toEqual(written)
    expect(written).toEqual({ transform: "translateX(10px) rotate(45deg)", opacity: "0" })
  })

  it("CBS3: initial as a function of the index; initial false, the targets; none, nothing", () => {
    const html = serve(() => {
      const fn = createBatch({ count: 2, initial: (i) => ({ y: i * 5 }), animate: () => ({ y: 100 }) })
      const quiet = createBatch({ count: 2, initial: false, animate: (i) => ({ x: i * 20, scale: 1 }) })
      const none = createBatch({ count: 1, animate: () => ({ x: 50, opacity: 0.5 }) })
      return (
        <>
          <div data-k="fn0" {...fn.at(0)} />
          <div data-k="fn1" {...fn.at(1)} />
          <div data-k="q0" {...quiet.at(0)} />
          <div data-k="q1" {...quiet.at(1)} />
          <div data-k="none" {...none.at(0)} />
        </>
      )
    })
    expect(tagOf(html, "fn0")?.style).toEqual({})
    expect(tagOf(html, "fn1")?.style).toEqual({ transform: "translateY(5px)" })
    expect(tagOf(html, "q0")?.style).toEqual({})
    expect(tagOf(html, "q1")?.style).toEqual({ transform: "translateX(20px)" })
    expect(tagOf(html, "none")?.style).toEqual({})
  })

  it("CBS4: keyed: each member's start by its item and index; an unlisted key renders none; initial={false} on a presence, the targets", () => {
    const items = [{ id: "a", n: 1 }, { id: "b", n: 2 }]
    const html = serve(() => {
      const list = createBatch({ each: () => items, key: "id", initial: (item, i) => ({ x: item.n * 100 + i, opacity: 0 }), animate: (_, i) => ({ x: i * 40, opacity: 1 }) })
      const quiet = createBatch({ each: () => items, key: "id", initial: { opacity: 0 }, animate: (_, i) => ({ y: i * 30, opacity: 1 }) })
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
    expect(tagOf(html, "l-a")?.style).toEqual({ transform: "translateX(100px)", opacity: "0" })
    expect(tagOf(html, "l-b")?.style).toEqual({ transform: "translateX(201px)", opacity: "0" })
    expect(tagOf(html, "l-z")?.style).toEqual({})
    expect(tagOf(html, "q-a")?.style).toEqual({})
    expect(tagOf(html, "q-b")?.style).toEqual({ transform: "translateY(30px)" })
  })

  it("CBS5: a handle given to ref alone renders nothing of the Batch's", () => {
    const html = serve(() => {
      const grid = createBatch({ count: 1, initial: { x: 10 }, animate: () => ({ x: 0 }) })
      return <div data-k="r" ref={grid.at(0).ref} />
    })
    expect(tagOf(html, "r")?.style).toEqual({})
  })

  it("CBS6: the client's errors are thrown on the server, with its messages", () => {
    const render = (make: () => unknown) => () => serve(make as () => never)
    expect(render(() => {
      const grid = createBatch({ count: 1, animate: () => ({ x: 0 }) })
      return <div {...grid.at(0, { style: "color: red" as never })} />
    })).toThrow(/give a member's own `style` as an object/)
    expect(render(() => {
      const grid = createBatch({ count: 1, initial: { x: "10px" as never }, animate: () => ({ x: 0 }) })
      return <div {...grid.at(0)} />
    })).toThrow(/member 0's "x" starts at "10px": a Batch's values are numbers/)
    expect(render(() => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: "1em" as never }) })
      return <div {...grid.at(0)} />
    })).toThrow(/member 0's "x" is "1em": a Batch's targets are numbers, one each/)
    expect(render(() => {
      const list = createBatch({ each: () => ["a"], key: (id) => id, keys: ["x"], initial: { opacity: 0 }, animate: () => ({ x: 0 }) })
      return <div {...list.member("a")} />
    })).toThrow(/member "a" starts at "opacity", which isn't one of its keys \(x\)/)
    expect(render(() => {
      const list = createBatch({ each: () => ["a", "a"], key: (id) => id, animate: () => ({ x: 0 }) })
      return <div {...list.member("a")} />
    })).toThrow(/items 0 and 1 both have the key "a"/)
  })
})
