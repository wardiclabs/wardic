// `<AnimatePresence>`'s `anchorX`, `anchorY` and `presenceAffectsLayout` on Solid 1 (#442, ADR-0048,
// Motion's props). Real frames.
//
// - PA1: `anchorX="right" anchorY="bottom"`: a leaver popped in place inside a positioned container
//   with padding and a border, pinned by its right and bottom.
// - PA2: the container shrinking as the leaver pops out: pinned by the bottom, it keeps its distance
//   from the container's bottom; by the top (the default), from its top.
// - PA3: the container narrowing as the leaver pops out: pinned by the right, it keeps its distance from
//   the container's right; by the left (the default), from its left.
// - PA4: right to left, `anchorX="right"` is the inline end: pinned by the left, in place.
// - PA5: a child entering pushes a `layout` sibling, which slides, though the child has no layout node
//   of its own (the presence tells the projection; before, the sibling jumped).
// - PA6: `presenceAffectsLayout={false}`: the presence tells the projection nothing: a sibling pushed by
//   a child entering jumps, and so does one taking a removed leaver's place.
// - PA7: a presence mounting with its child pushes a `layout` element after it, which slides, as Motion's
//   parent re-render makes it.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

// The exit outlasts the siblings' layout slide (its `layout` key): the leaver still exits as they land.
const EXIT = { type: "tween", duration: 0.8, layout: { type: "tween", duration: 0.3 } } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

interface ListOptions {
  readonly mode?: "sync" | "popLayout"
  readonly anchorX?: "left" | "right"
  readonly anchorY?: "top" | "bottom"
  readonly presenceAffectsLayout?: boolean
  /** The items with `layout`; none when left out. */
  readonly laid?: ReadonlyArray<string>
  readonly itemStyle?: (item: string) => JSX.CSSProperties
  readonly listStyle?: JSX.CSSProperties
  readonly dir?: "rtl"
}

/** A presence around a `<For>` of Wardic items, 40px tall, that fade out, in a list. */
const mountList = (start: ReadonlyArray<string>, options: ListOptions = {}) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const laid = new Set(options.laid)
  const layoutOf = (item: string) => Bool.match(laid.has(item), { onTrue: () => ({ layout: true }), onFalse: () => ({}) })
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <ul data-list dir={options.dir} style={{ margin: "0", padding: "0", "list-style": "none", ...options.listStyle }}>
        <AnimatePresence mode={options.mode} anchorX={options.anchorX} anchorY={options.anchorY} presenceAffectsLayout={options.presenceAffectsLayout}>
          <For each={items()}>
            {(item) => (
              <wardic.li data-item={item} {...layoutOf(item)} exit={{ opacity: 0 }} transition={EXIT} style={{ display: "block", height: "40px", ...options.itemStyle?.(item) }}>
                {item}
              </wardic.li>
            )}
          </For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  const node = (item: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${item}"]`)!
  const list = container.querySelector<HTMLElement>("[data-list]")!
  return { setItems, node, list }
}

/** Where `el` is drawn, rounded to a tenth of a pixel. */
const rectOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  const tenth = (n: number): number => Math.round(n * 10) / 10
  return { left: tenth(r.left), top: tenth(r.top), right: tenth(r.right), bottom: tenth(r.bottom), width: tenth(r.width), height: tenth(r.height) }
}

/** Watch `el`'s top over frames until `done`: whether it was seen strictly between `from` and `to`. */
const slides = async (el: HTMLElement, from: number, to: number, done: () => boolean): Promise<boolean> => {
  let sawMid = false
  const low = Math.min(from, to) + 3
  const high = Math.max(from, to) - 3
  await until(() => {
    const top = el.getBoundingClientRect().top
    if (top > low && top < high) sawMid = true
    return done()
  }, 3000)
  return sawMid
}

describe("AnimatePresence's anchorX, anchorY and presenceAffectsLayout on Solid 1 (#442)", () => {
  it("PA1: anchored right and bottom, a leaver is popped in place in a positioned container with padding and a border", async () => {
    const list = mountList(["a", "b", "c"], {
      mode: "popLayout",
      anchorX: "right",
      anchorY: "bottom",
      // A fixed height: it doesn't shrink as the leaver pops (PA2 is one that does).
      listStyle: { position: "relative", width: "300px", height: "200px", padding: "7px 13px 11px 5px", border: "3px solid black" },
      itemStyle: () => ({ width: "120px", margin: "4px 9px 6px 2px" }),
    })
    await frames(5)
    const b = list.node("b")
    const bWas = rectOf(b)
    list.setItems(["a", "c"])
    expect(getComputedStyle(b).position, "out of the flow").toBe("absolute")
    expect([b.style.getPropertyValue("right"), b.style.getPropertyValue("bottom")], "pinned by its right and bottom").not.toContain("")
    expect([b.style.getPropertyValue("left"), b.style.getPropertyValue("top")], "not by its left or top").toEqual(["", ""])
    await raf()
    const at = rectOf(b)
    expect([at.left, at.top, at.width, at.height], "in place").toEqual([bWas.left, bWas.top, bWas.width, bWas.height])
  })

  it("PA2: the container shrinking as it pops: by the bottom it keeps the container's bottom, by the top its top", async () => {
    for (const anchorY of ["bottom", "top"] as const) {
      const list = mountList(["a", "b", "c"], { mode: "popLayout", anchorY, listStyle: { position: "relative", width: "200px" } })
      await frames(5)
      const b = list.node("b")
      const before = { b: rectOf(b), list: rectOf(list.list) }
      list.setItems(["a", "c"])
      await raf()
      await raf()
      const after = { b: rectOf(b), list: rectOf(list.list) }
      expect(after.list.height, "the container shrank").toBe(before.list.height - 40)
      if (anchorY === "bottom") expect(after.list.bottom - after.b.bottom, "bottom: from the container's bottom").toBe(before.list.bottom - before.b.bottom)
      if (anchorY === "top") expect(after.b.top - after.list.top, "top: from the container's top").toBe(before.b.top - before.list.top)
      cleanup()
    }
  })

  it("PA3: the container narrowing as it pops: by the right it keeps the container's right, by the left its left", async () => {
    for (const anchorX of ["right", "left"] as const) {
      const list = mountList(["a", "b", "c"], {
        mode: "popLayout",
        anchorX,
        listStyle: { position: "relative", width: "fit-content" },
        itemStyle: (item) => ({ width: Bool.match(item === "b", { onTrue: () => "200px", onFalse: () => "100px" }) }),
      })
      await frames(5)
      const b = list.node("b")
      const before = { b: rectOf(b), list: rectOf(list.list) }
      list.setItems(["a", "c"])
      await raf()
      await raf()
      const after = { b: rectOf(b), list: rectOf(list.list) }
      expect(after.list.width, "the container narrowed").toBe(100)
      if (anchorX === "right") expect(after.list.right - after.b.right, "right: from the container's right").toBe(before.list.right - before.b.right)
      if (anchorX === "left") expect(after.b.left - after.list.left, "left: from the container's left").toBe(before.b.left - before.list.left)
      cleanup()
    }
  })

  it("PA4: right to left, anchorX right is the inline end: pinned by the left, in place", async () => {
    const list = mountList(["a", "b", "c"], {
      mode: "popLayout",
      anchorX: "right",
      dir: "rtl",
      listStyle: { position: "relative", width: "300px", padding: "0 6px" },
      itemStyle: () => ({ width: "120px", "margin-inline-end": "9px" }),
    })
    await frames(5)
    const b = list.node("b")
    const bWas = rectOf(b)
    list.setItems(["a", "c"])
    expect([b.style.getPropertyValue("left"), b.style.getPropertyValue("right")], "by its left").toEqual([b.style.getPropertyValue("left"), ""])
    expect(b.style.getPropertyValue("left")).not.toBe("")
    expect(rectOf(b)).toEqual(bWas)
  })

  it("PA5: a child entering pushes a layout sibling, which slides, though the child has no layout node", async () => {
    const list = mountList(["a", "b"], { laid: ["a", "b"] })
    await frames(5)
    const a = list.node("a")
    const aWas = a.getBoundingClientRect().top
    list.setItems(["z", "a", "b"])
    // Its first frame draws it where it was, then it slides.
    await raf()
    const sawMid = await slides(a, aWas, aWas + 40, () => Math.abs(a.getBoundingClientRect().top - aWas - 40) < 0.5)
    expect(sawMid, "a slid down").toBe(true)
  })

  it("PA6: presenceAffectsLayout false: a sibling pushed by a child entering jumps, and so does one taking a removed leaver's place", async () => {
    const list = mountList(["a", "b"], { laid: ["a", "b"], presenceAffectsLayout: false })
    await frames(5)
    const a = list.node("a")
    const aWas = a.getBoundingClientRect().top
    list.setItems(["z", "a", "b"])
    await raf()
    await raf()
    expect(a.getBoundingClientRect().top, "a at its new place at once").toBeCloseTo(aWas + 40, 0)
    // z leaves: once it's removed, a jumps back.
    list.setItems(["a", "b"])
    const z = list.node("z")
    await until(() => !z.isConnected, 3000)
    await raf()
    await raf()
    expect(a.getBoundingClientRect().top, "a back at once").toBeCloseTo(aWas, 0)
  })

  it("PA7: a presence mounting with its child pushes a layout element after it, which slides", async () => {
    const [shown, setShown] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div>
          <Show when={shown()}>
            <AnimatePresence>
              <div style={{ height: "40px" }}>banner</div>
            </AnimatePresence>
          </Show>
          <wardic.div data-below layout transition={EXIT} style={{ height: "40px" }} />
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const below = container.querySelector<HTMLElement>("[data-below]")!
    const was = below.getBoundingClientRect().top
    setShown(true)
    await raf()
    const sawMid = await slides(below, was, was + 40, () => Math.abs(below.getBoundingClientRect().top - was - 40) < 0.5)
    expect(sawMid, "it slid down").toBe(true)
  })
})
