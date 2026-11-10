// `createBatch`'s keyed form on Solid 2 (#665, PR 3a, Q42–Q45, Q51): Solid 1's (`../create-batch-keyed.browser.test.tsx`),
// each member held to a keyed `w.div` with the same props, frame for frame.
//
// - CVK1: through a mount, a reorder, an item added and one removed, each member draws what a `w.div` keyed
//   to the same item draws, its `i` the item's index in `each`.
// - CVK2: `createAnimate`'s `animate` moves one member by its handle and every member by a function of its
//   index; a list that starts empty makes its Batch at its first members, `settled()` landing them.
// - CVK3: a member's handle keeps its element's own `style` and calls its `ref`; an element `<For>` makes
//   again for the same key carries the member on; a handle kept past its member's leave moves nothing.
//
// Its misuse errors are the shared work's, and Solid 1's CK4 and CK5 hold them: one thrown in a Solid 2
// render halts that root's reactive system for the file's later tests.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { createAnimate, createBatch, w, type WardicAnimate, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, For, untrack } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

interface Item {
  readonly id: string
}

/** `count` frames. */
const frames = async (count: number): Promise<void> => {
  for (let f = 0; f < count; f++) await raf()
}

/** `count` frames of each pair's `x`s, member and ward, read after each frame. */
const pairsOver = async (count: number, pairs: () => ReadonlyArray<readonly [Element, Element]>): Promise<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> => {
  const out: Array<Array<readonly [number, number]>> = []
  for (let f = 0; f < count; f++) {
    await raf()
    out.push(pairs().map(([member, ward]) => [xOf(member), xOf(ward)] as const))
  }
  return out
}

/** The members' `x`s at the last frame. */
const lastXs = (read: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): ReadonlyArray<number> => read[read.length - 1].map(([x]) => x)

/** Each frame's member within 1e-6 of its ward. */
const expectPairs = (read: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): void =>
  read.forEach((pairs, f) => pairs.forEach(([member, ward], p) => expect(member, `frame ${f}, pair ${p}`).toBeCloseTo(ward, 6)))

describe("createBatch's keyed form on Solid 2 (#665)", () => {
  it("CVK1: through a mount, a reorder, an add and a remove, each member draws what its keyed w.div draws", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    const members = new Map<string, HTMLDivElement>()
    const wards = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      const list = createBatch({ each: items, key: "id", initial: { x: -30 }, animate: (_, i) => ({ x: i * 40 }), transition: SPRING })
      return (
        <>
          <For each={items()}>{(item) => <div style={BOX} {...list.member(item.id, { ref: (el) => members.set(item.id, el as HTMLDivElement) })} />}</For>
          <For each={items()}>{(item, i) => <w.div ref={(el: HTMLDivElement) => wards.set(item.id, el)} style={BOX} initial={{ x: -30 }} animate={{ x: i() * 40 }} transition={SPRING} />}</For>
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    // The list as the test last set it, read outside any tracking.
    const listed = (): ReadonlyArray<Item> => untrack(items)
    const pairs = () => listed().map((item) => [members.get(item.id) as Element, wards.get(item.id) as Element] as const)
    const mounted = await pairsOver(50, pairs)
    expectPairs(mounted)
    expect(lastXs(mounted)).toEqual([0, 40, 80])
    const [a, b, c] = listed()
    setItems([c, a, b])
    const reordered = await pairsOver(50, pairs)
    expectPairs(reordered)
    expect(lastXs(reordered)).toEqual([0, 40, 80])
    setItems([listed()[0], { id: "d" }, ...listed().slice(1)])
    const added = await pairsOver(50, pairs)
    expectPairs(added)
    expect(lastXs(added)).toEqual([0, 40, 80, 120])
    setItems(listed().filter((item) => item.id !== "a"))
    const removed = await pairsOver(50, pairs)
    expectPairs(removed)
    expect(lastXs(removed)).toEqual([0, 40, 80])
  })

  it("CVK2: animate moves a member by its handle and every member by (i, n); an empty list makes its Batch at its first members", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([])
    const members = new Map<string, HTMLDivElement>()
    let list!: ReturnType<typeof keyedList>
    let animate!: WardicAnimate
    const keyedList = () => createBatch({ each: items, key: "id", animate: (_, i) => ({ x: i * 40 }), transition: SPRING })
    const Scene = (): JSX.Element => {
      list = keyedList()
      const [scope, made] = createAnimate()
      animate = made
      return (
        <div ref={scope}>
          <For each={items()}>{(item) => <div style={BOX} {...list.member(item.id, { ref: (el) => members.set(item.id, el as HTMLDivElement) })} />}</For>
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await raf()
    // Nothing to move yet: it finishes at once.
    let finished = false
    void animate(list, { x: 50 }).then(() => {
      finished = true
    })
    await raf()
    expect(finished).toBe(true)
    const landing = list.next("settled")
    setItems([{ id: "a" }, { id: "b" }, { id: "c" }])
    await expect(landing).resolves.toEqual({ moved: 2 })
    expect(["a", "b", "c"].map((id) => xOf(members.get(id) as Element))).toEqual([0, 40, 80])
    await animate(list.member("b"), { x: 200 }, { duration: 0.1 })
    expect(xOf(members.get("b") as Element)).toBe(200)
    await animate(list, { x: (i, n) => 100 * i + n }, { duration: 0.1 })
    await frames(2)
    expect(["a", "b", "c"].map((id) => xOf(members.get(id) as Element))).toEqual([3, 103, 203])
  })

  it("CVK3: a handle keeps its element's style and ref; a remade element carries on; a handle kept past its leave moves nothing", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    const listed = (): ReadonlyArray<Item> => untrack(items)
    const steadyItems: ReadonlyArray<Item> = [{ id: "a" }, { id: "b" }, { id: "c" }]
    const members = new Map<string, HTMLDivElement>()
    const steady = new Map<string, HTMLDivElement>()
    let own!: HTMLDivElement
    let list!: ReturnType<typeof keyedList>
    let animate!: WardicAnimate
    const keyedList = () => createBatch({ each: items, key: "id", animate: (_, i) => ({ x: i * 40 }), transition: SPRING })
    const Scene = (): JSX.Element => {
      list = keyedList()
      const other = createBatch({ each: () => steadyItems, key: "id", animate: (_, i) => ({ x: i * 40 }), transition: SPRING })
      const [scope, made] = createAnimate()
      animate = made
      return (
        <div ref={scope}>
          <For each={items()}>
            {(item) => (
              <div
                {...list.member(item.id, {
                  style: { width: "12px", transform: "scale(2)" },
                  ref: (el) => {
                    members.set(item.id, el as HTMLDivElement)
                    if (item.id === "b") own = el as HTMLDivElement
                  },
                })}
              />
            )}
          </For>
          <For each={steadyItems}>{(item) => <div style={BOX} {...other.member(item.id, { ref: (el) => steady.set(item.id, el as HTMLDivElement) })} />}</For>
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(6)
    expect([own.style.width, own.style.transform.includes("scale(2)")]).toEqual(["12px", false])
    // Item `a` made again mid-flight: its member carries on as the steady list's does.
    const first = members.get("a")
    setItems([{ id: "a" }, ...listed().slice(1)])
    const read = await pairsOver(30, () => [[members.get("a") as Element, steady.get("a") as Element]])
    expect(members.get("a")).not.toBe(first)
    expectPairs(read)
    // A handle kept past its member's leave: a later member may have its number, and isn't moved.
    const gone = list.member("c")
    setItems(listed().filter((item) => item.id !== "c"))
    await raf()
    setItems([...listed(), { id: "e" }])
    await frames(40)
    const e = xOf(members.get("e") as Element)
    await animate(gone, { x: 999 }, { duration: 0.05 })
    await frames(2)
    expect(xOf(members.get("e") as Element)).toBe(e)
  })
})
