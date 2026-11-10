// `createBatch`'s keyed form on Solid 1 (#665, PR 3a, Q42–Q45, Q51): a list's items as a Batch's
// members, each held to a keyed `wardic.div` with the same props, frame for frame.
//
// - CK1: through a mount, a reorder, an item added and one removed, each member draws what a `wardic.div`
//   keyed to the same item draws, its `i` the item's index in `each`.
// - CK2: a member's handle keeps its element's own `style` and calls its `ref`; an element `<For>` makes
//   again for the same key carries the member on; `createAnimate`'s `animate` moves one member by its
//   handle and every member by a function of its index and the list's length; a handle kept past its
//   member's leave moves nothing.
// - CK3: a Batch whose list starts empty is made at its first members, `animate` of it finishing at once
//   before then; its `keys` fix its keys up front (Q51).
// - CK4: an element for a key the list never has is reported, naming it; an item with no key, two items
//   with one key, and a key a later target gives are errors naming them.
// - CK5: an element reported for its key enters once the list has it; a list that starts empty leaves its
//   first handles' `style` the properties the Batch draws; a later member's `initial` key outside the
//   Batch's is an error naming it; a sequence's Segment of a keyed Batch moves its members in the list's
//   order, and nothing before it has members; a member's element in an element call moves it in the Batch.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { createAnimate, createBatch, stagger, wardic, type WardicAnimate, type WardicBatchMember, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

interface Item {
  readonly id: string
}

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** `count` frames. */
const frames = async (count: number): Promise<void> => {
  for (let f = 0; f < count; f++) await raf()
}

/**
 * A keyed Batch on `x` over `items`, each member at `x: i * 40` from `x: -30`, its elements by key, under
 * one provider and an animation scope.
 */
const mountList = (items: () => ReadonlyArray<Item>) => {
  const members = new Map<string, HTMLDivElement>()
  let list!: ReturnType<typeof keyedList>
  let animate!: WardicAnimate
  const keyedList = () => createBatch({ each: items, key: "id", initial: { x: -30 }, animate: (_, i) => ({ x: i * 40 }), transition: SPRING })
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
  render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { list, animate: () => animate, members }
}

/** `frames` frames of each pair's `x`s, member and ward, read after each frame. */
const pairsOver = async (frames: number, pairs: () => ReadonlyArray<readonly [Element, Element]>): Promise<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> => {
  const out: Array<Array<readonly [number, number]>> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push(pairs().map(([member, ward]) => [xOf(member), xOf(ward)] as const))
  }
  return out
}

/** The members' `x`s at the last frame. */
const lastXs = (frames: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): ReadonlyArray<number> => frames[frames.length - 1].map(([x]) => x)

/** Each frame's member within 1e-6 of its ward. */
const expectPairs = (frames: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): void =>
  frames.forEach((pairs, f) => pairs.forEach(([member, ward], p) => expect(member, `frame ${f}, pair ${p}`).toBeCloseTo(ward, 6)))

describe("createBatch's keyed form on Solid 1 (#665)", () => {
  it("CK1: through a mount, a reorder, an add and a remove, each member draws what its keyed wardic.div draws", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    const members = new Map<string, HTMLDivElement>()
    const wards = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      const list = createBatch({ each: items, key: "id", initial: { x: -30 }, animate: (_, i) => ({ x: i * 40 }), transition: SPRING })
      return (
        <>
          <For each={items()}>{(item) => <div style={BOX} {...list.member(item.id, { ref: (el) => members.set(item.id, el as HTMLDivElement) })} />}</For>
          <For each={items()}>{(item, i) => <wardic.div ref={(el: HTMLDivElement) => wards.set(item.id, el)} style={BOX} initial={{ x: -30 }} animate={{ x: i() * 40 }} transition={SPRING} />}</For>
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    const pairs = () => items().map((item) => [members.get(item.id) as Element, wards.get(item.id) as Element] as const)
    const mounted = await pairsOver(50, pairs)
    expectPairs(mounted)
    expect(lastXs(mounted)).toEqual([0, 40, 80])
    // Reordered: every member turns toward its new place, from where it is.
    const [a, b, c] = items()
    setItems([c, a, b])
    const reordered = await pairsOver(50, pairs)
    expectPairs(reordered)
    expect(lastXs(reordered)).toEqual([0, 40, 80])
    // An item added in the middle enters from `initial`; the one after it moves on.
    setItems([items()[0], { id: "d" }, ...items().slice(1)])
    const added = await pairsOver(50, pairs)
    expectPairs(added)
    expect(lastXs(added)).toEqual([0, 40, 80, 120])
    // One removed: the rest close up.
    setItems(items().filter((item) => item.id !== "a"))
    const removed = await pairsOver(50, pairs)
    expectPairs(removed)
    expect(lastXs(removed)).toEqual([0, 40, 80])
  })

  it("CK2: handles keep their element's own style and ref; a remade element carries on; animate by handle and by (i, n)", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    // Its own style and ref beside the handle's, the properties the Batch draws left to it.
    let own!: HTMLDivElement
    const Styled = (): JSX.Element => {
      const list = createBatch({ each: items, key: (item) => item.id, animate: (_, i) => ({ x: i * 40 }) })
      return <For each={items()}>{(item) => <div {...list.member(item.id, { style: { width: "12px", transform: "scale(2)" }, ref: (el) => { if (item.id === "b") own = el as HTMLDivElement } })} />}</For>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Styled />
      </WardicProvider>
    ))
    await frames(2)
    expect([own.style.width, own.style.transform.includes("scale(2)")]).toEqual(["12px", false])
    cleanup()
    // Two lists alike, one whose item `a` is made again mid-flight: its member carries on as the other's does.
    const [again, setAgain] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }])
    const steadyItems: ReadonlyArray<Item> = [{ id: "a" }, { id: "b" }]
    const remade = mountList(again)
    const steady = mountList(() => steadyItems)
    await frames(6)
    const first = remade.members.get("a") as Element
    setAgain([{ id: "a" }, again()[1]])
    const xs = await (async () => {
      const out: Array<readonly [number, number]> = []
      for (let f = 0; f < 30; f++) {
        await raf()
        out.push([xOf(remade.members.get("a") as Element), xOf(steady.members.get("a") as Element)])
      }
      return out
    })()
    expect(remade.members.get("a")).not.toBe(first)
    xs.forEach(([x, other], f) => expect(x, `frame ${f}`).toBeCloseTo(other, 6))
    cleanup()
    // animate by a member's handle, and by a function of each member's index in the list and its length.
    const { list, animate, members } = mountList(items)
    await frames(40)
    await animate()(list.member("b"), { x: 200 }, { duration: 0.1 })
    expect([xOf(members.get("a") as Element), xOf(members.get("b") as Element)]).toEqual([0, 200])
    setItems([items()[2], items()[0], items()[1]])
    await animate()(list, { x: (i, n) => 100 * i + n }, { duration: 0.1 })
    expect(["c", "a", "b"].map((id) => xOf(members.get(id) as Element))).toEqual([3, 103, 203])
    // A handle kept past its member's leave: a later member may have its number, and isn't moved.
    const gone = list.member("c")
    setItems(items().filter((item) => item.id !== "c"))
    setItems([...items(), { id: "e" }])
    await frames(40)
    const e = xOf(members.get("e") as Element)
    await animate()(gone, { x: 999 }, { duration: 0.05 })
    await frames(2)
    expect(xOf(members.get("e") as Element)).toBe(e)
  })

  it("CK3: a list that starts empty makes its Batch at its first members; keys fix its keys up front", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([])
    const { list, animate, members } = mountList(items)
    await raf()
    let finished = false
    void animate()(list, { x: 50 }).then(() => {
      finished = true
    })
    await raf()
    expect(finished).toBe(true)
    setItems([{ id: "a" }, { id: "b" }])
    await frames(50)
    expect([xOf(members.get("a") as Element), xOf(members.get("b") as Element)]).toEqual([0, 40])
    cleanup()
    // Its keys given up front: a later item's `opacity` is one of them.
    const [later, setLater] = createSignal<ReadonlyArray<Item>>([])
    const faded = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      const fading = createBatch({ each: later, key: "id", keys: ["x", "opacity"], initial: { opacity: 0 }, animate: (item) => ({ opacity: Number(item.id === "b") * 0.5 + 0.5 }) })
      return <For each={later()}>{(item) => <div style={BOX} {...fading.member(item.id, { ref: (el) => faded.set(item.id, el as HTMLDivElement) })} />}</For>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    setLater([{ id: "a" }, { id: "b" }])
    await frames(60)
    expect([opacityOf(faded.get("a") as Element), opacityOf(faded.get("b") as Element)]).toEqual([0.5, 1])
  })

  it("CK4: an element for a key the list never has is reported; no key, a key twice and a later key are errors naming them", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const Stray = (): JSX.Element => {
      const list = createBatch({ each: () => [{ id: "a" }], key: "id", animate: () => ({ x: 10 }) })
      return <div {...list.member("zz")} />
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Stray />
      </WardicProvider>
    ))
    await frames(2)
    expect(errorsNamed(logs, "createBatch: a member's element has no item")).toHaveLength(1)
    expect(reports.join("\n")).toMatch(/member "zz"'s handle/)
    cleanup()
    const Keyless = (): JSX.Element => {
      createBatch({ each: () => [{ id: "a" }, { name: "b" } as never], key: "id", animate: () => ({ x: 10 }) })
      return null
    }
    expect(() => render(() => <WardicProvider env={DomLive}><Keyless /></WardicProvider>)).toThrow(/item 1's key is undefined/)
    cleanup()
    const Twice = (): JSX.Element => {
      createBatch({ each: () => [{ id: "a" }, { id: "a" }], key: "id", animate: () => ({ x: 10 }) })
      return null
    }
    expect(() => render(() => <WardicProvider env={DomLive}><Twice /></WardicProvider>)).toThrow(/items 0 and 1 both have the key "a"/)
    cleanup()
    const [items, setItems] = createSignal<ReadonlyArray<{ readonly id: string; readonly y?: number }>>([{ id: "a" }])
    const Later = (): JSX.Element => {
      createBatch({ each: items, key: "id", animate: (item) => Bool.match(Predicate.hasProperty(item, "y"), { onTrue: () => ({ x: 1, y: item.y as number }), onFalse: () => ({ x: 1 }) }) })
      return null
    }
    render(() => <WardicProvider env={DomLive}><Later /></WardicProvider>)
    expect(() => setItems([{ id: "a" }, { id: "b", y: 2 }])).toThrow(/member "b"'s targets give "y"/)
  })

  it("CK5: a reported element enters later; an empty start's handles; a later initial key; Segments and element calls", async () => {
    // Reported, then listed: it enters.
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }])
    let stray!: HTMLDivElement
    const Stray = (): JSX.Element => {
      const list = createBatch({ each: items, key: "id", animate: (_, i) => ({ x: 10 + i }) })
      return <div {...list.member("zz", { ref: (el) => (stray = el as HTMLDivElement) })} />
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Stray />
      </WardicProvider>
    ))
    await frames(2)
    expect(errorsNamed(logs, "createBatch: a member's element has no item")).toHaveLength(1)
    setItems([{ id: "a" }, { id: "zz" }])
    await frames(40)
    expect(xOf(stray)).toBe(11)
    expect(errorsNamed(logs, "createBatch: a member's element has no item")).toHaveLength(1)
    cleanup()
    // A list that starts empty: its first handles leave the Batch its `transform`.
    const [later, setLater] = createSignal<ReadonlyArray<Item>>([])
    const handles: Array<WardicBatchMember> = []
    const Empty = (): JSX.Element => {
      const list = createBatch({ each: later, key: "id", animate: () => ({ x: 5 }) })
      return (
        <For each={later()}>
          {(item) => {
            const handle = list.member(item.id, { style: { width: "12px", transform: "scale(2)" } })
            handles.push(handle)
            return <div {...handle} />
          }}
        </For>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Empty />
      </WardicProvider>
    ))
    setLater([{ id: "a" }])
    expect(handles[0].style).toEqual({ width: "12px" })
    cleanup()
    // A later member's `initial` with a key the Batch doesn't have.
    const [grown, setGrown] = createSignal<ReadonlyArray<Item>>([{ id: "a" }])
    const Initial = (): JSX.Element => {
      const list = createBatch({ each: grown, key: "id", initial: (item) => Bool.match(item.id === "b", { onTrue: () => ({ x: 0, opacity: 0 }), onFalse: () => ({ x: 0 }) }), animate: () => ({ x: 5 }) })
      return <For each={grown()}>{(item) => <div {...list.member(item.id)} />}</For>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Initial />
      </WardicProvider>
    ))
    expect(() => setGrown([{ id: "a" }, { id: "b" }])).toThrow(/member "b" starts at "opacity", which isn't one of its keys \(x\)/)
    cleanup()
    // A sequence's Segment of a keyed Batch: nothing before it has members, then its members in the list's order.
    const [listed, setListed] = createSignal<ReadonlyArray<Item>>([])
    const { list, animate, members } = mountList(listed)
    await raf()
    let finished = false
    void animate()([[list, { x: 10 }]]).then(() => {
      finished = true
    })
    await raf()
    expect(finished).toBe(true)
    setListed([{ id: "c" }, { id: "a" }, { id: "b" }])
    await frames(50)
    void animate()([[list, { x: (i) => 100 + i }, { duration: 0.2, delay: stagger(0.15) }]])
    await frames(6)
    // c, first in the list, has set off; a waits its 0.15 s.
    expect(xOf(members.get("c") as Element)).toBeGreaterThan(1)
    expect(xOf(members.get("a") as Element)).toBe(40)
    await frames(50)
    expect(["c", "a", "b"].map((id) => xOf(members.get(id) as Element))).toEqual([100, 101, 102])
    // A member's element in an element call moves it in the Batch: a change of the list turns it on from there.
    await animate()(members.get("a") as Element, { x: 77 }, { duration: 0.1 })
    setListed([listed()[1], listed()[0], listed()[2]])
    await raf()
    expect(xOf(members.get("a") as Element)).toBeGreaterThan(70)
  })
})
