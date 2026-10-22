// `<AnimatePresence>` around many children on Solid 1 (#277, ADR-0048): a `<For>`'s items, each a
// DOM node, each that leaves exiting on its own, in its place. Real frames.
//
// - MC1: an item removed from the middle exits in its place, between the others, and then goes, for good.
// - MC2: two neighbours removed at once both exit, in their order.
// - MC3: the list emptied: each item exits; none vanishes with the list's nodes.
// - MC4: exits that overlap: `onExitComplete` once, after the last is gone.
// - MC5: an item added while another exits enters beside it.
// - MC6: an item removed and added back mid-exit: a new node enters while the old one finishes (#286
//   would key them).
// - MC7: a plain (non-Wardic) item leaves at once.
// - MC8: an item already exiting when the list is emptied stays for its exit.
// - MC9: `initial={false}`: every item of the first render starts at its `animate`; one added later
//   animates in from its `initial`.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const EXIT = { type: "tween", duration: 0.15 } as const

/** A presence around a `<For>` of Wardic items; `onExitComplete` counts its calls. */
const mountList = (start: ReadonlyArray<string>, plain = false, initial = true) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  let completes = 0
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <ul>
        <AnimatePresence initial={initial} onExitComplete={() => completes++}>
          <For each={items()}>
            {(item) =>
              Bool.match(plain, {
                onTrue: () => <li data-item={item}>{item}</li>,
                onFalse: () => (
                  <wardic.li data-item={item} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                    {item}
                  </wardic.li>
                ),
              })
            }
          </For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  const nodes = (): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>("[data-item]"))
  const order = (): Array<string> => nodes().map((n) => n.dataset.item!)
  const node = (item: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${item}"]`)!
  return { items, setItems, nodes, order, node, completes: () => completes }
}

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** Every item shown, at rest. */
const allIn = async (list: ReturnType<typeof mountList>): Promise<void> => {
  await until(() => list.nodes().every((n) => opacityOf(n) >= 0.99), 2000)
}

describe("AnimatePresence around many children on Solid 1 (#277)", () => {
  it("MC1: an item removed from the middle exits in its place, then goes", async () => {
    const list = mountList(["a", "b", "c"])
    await allIn(list)
    const b = list.node("b")
    list.setItems(["a", "c"])
    expect(list.order(), "in its place while it exits").toEqual(["a", "b", "c"])
    let sawMid = false
    await until(() => {
      if (b.isConnected && opacityOf(b) > 0.05 && opacityOf(b) < 0.95) sawMid = true
      return !b.isConnected
    }, 3000)
    expect(sawMid, "it animated out").toBe(true)
    expect(list.order()).toEqual(["a", "c"])
    // A later change doesn't bring it back.
    list.setItems(["a", "c", "d"])
    await raf()
    expect(list.order()).toEqual(["a", "c", "d"])
  })

  it("MC2: two neighbours removed at once both exit, in their order", async () => {
    const list = mountList(["a", "b", "c", "d"])
    await allIn(list)
    list.setItems(["a", "d"])
    expect(list.order()).toEqual(["a", "b", "c", "d"])
    await frames(3)
    expect(list.order(), "still in order mid-exit").toEqual(["a", "b", "c", "d"])
    await until(() => list.nodes().length === 2, 3000)
    expect(list.order()).toEqual(["a", "d"])
  })

  it("MC3: the list emptied: each item exits, none vanishing with the list's nodes", async () => {
    const list = mountList(["a", "b", "c"])
    await allIn(list)
    list.setItems([])
    expect(list.order(), "all retained").toEqual(["a", "b", "c"])
    await frames(3)
    expect(list.nodes().every((n) => opacityOf(n) < 1), "each exiting").toBe(true)
    await until(() => list.nodes().length === 0, 3000)
    expect(list.nodes()).toEqual([])
  })

  it("MC4: exits that overlap: onExitComplete once, after the last is gone", async () => {
    const list = mountList(["a", "b", "c"])
    await allIn(list)
    list.setItems(["b", "c"])
    await frames(3)
    list.setItems(["b"])
    await until(() => list.completes() > 0, 3000)
    expect(list.order(), "both gone when it's called").toEqual(["b"])
    await frames(10)
    expect(list.completes(), "once").toBe(1)
  })

  it("MC5: an item added while another exits enters beside it", async () => {
    const list = mountList(["a", "b"])
    await allIn(list)
    const a = list.node("a")
    list.setItems(["b"])
    await frames(3)
    list.setItems(["b", "c"])
    expect(a.isConnected, "a exits on").toBe(true)
    expect(opacityOf(list.node("c")), "c enters from its initial").toBe(0)
    await until(() => !a.isConnected, 3000)
    await until(() => opacityOf(list.node("c")) >= 0.99, 2000)
    expect(list.order()).toEqual(["b", "c"])
  })

  it("MC6: an item removed and added back mid-exit: a new node enters while the old one finishes", async () => {
    const list = mountList(["a", "b"])
    await allIn(list)
    const old = list.node("b")
    list.setItems(["a"])
    await frames(3)
    list.setItems(["a", "b"])
    const both = list.nodes().filter((n) => n.dataset.item === "b")
    expect(both.length, "the old one exiting, the new one entering").toBe(2)
    expect(both).toContain(old)
    await until(() => !old.isConnected, 3000)
    expect(list.order()).toEqual(["a", "b"])
    expect(list.node("b")).not.toBe(old)
  })

  it("MC7: a plain item leaves at once", async () => {
    const list = mountList(["a", "b"], true)
    await frames(2)
    list.setItems(["a"])
    await raf()
    expect(list.order()).toEqual(["a"])
    expect(list.completes()).toBe(1)
  })

  it("MC8: an item already exiting when the list is emptied stays for its exit", async () => {
    const list = mountList(["a", "b"])
    await allIn(list)
    const a = list.node("a")
    list.setItems(["b"])
    await frames(3)
    list.setItems([])
    expect(a.isConnected, "a, mid-exit, still there").toBe(true)
    expect(list.order()).toEqual(["a", "b"])
    await until(() => list.nodes().length === 0, 3000)
    expect(list.nodes()).toEqual([])
  })

  it("MC9: initial={false}: the first render's items start at animate, a later one animates in", async () => {
    const list = mountList(["a", "b", "c"], false, false)
    expect(list.nodes().map(opacityOf), "the first render's at animate").toEqual([1, 1, 1])
    await frames(2)
    expect(list.nodes().map(opacityOf)).toEqual([1, 1, 1])
    list.setItems(["a", "b", "c", "d"])
    expect(opacityOf(list.node("d")), "a later one from its initial").toBe(0)
    await until(() => opacityOf(list.node("d")) >= 0.99, 2000)
    expect(opacityOf(list.node("d"))).toBeGreaterThanOrEqual(0.99)
  })
})
