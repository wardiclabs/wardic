// `<AnimatePresence>`'s `anchorX`, `anchorY` and `presenceAffectsLayout` on Solid 2 (#442), as Solid 1's
// PA tests pin them. Real frames.
//
// - PAV1: the container shrinking and narrowing as the leaver pops out: pinned by the bottom right, it
//   keeps its distances from the container's bottom and right.
// - PAV2: a child entering pushes a `layout` sibling, which slides, though the child has no layout node.
// - PAV3: `presenceAffectsLayout={false}`: a sibling pushed by a child entering jumps.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const EXIT = { type: "tween", duration: 0.8, layout: { type: "tween", duration: 0.3 } } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

interface ListOptions {
  readonly mode?: "sync" | "popLayout"
  readonly anchorX?: "left" | "right"
  readonly anchorY?: "top" | "bottom"
  readonly presenceAffectsLayout?: boolean
  readonly laid?: ReadonlyArray<string>
  readonly itemStyle?: (item: string) => JSX.CSSProperties
  readonly listStyle?: JSX.CSSProperties
}

/** A presence around a `<For>` of Wardic items, 40px tall, that fade out, in a list. */
const mountList = (start: ReadonlyArray<string>, options: ListOptions = {}) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const laid = new Set(options.laid)
  const layoutOf = (item: string) => Bool.match(laid.has(item), { onTrue: () => ({ layout: true }), onFalse: () => ({}) })
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <ul data-list style={{ margin: "0", padding: "0", "list-style": "none", ...options.listStyle }}>
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
  const node = (item: string): HTMLElement => host.querySelector<HTMLElement>(`[data-item="${item}"]`)!
  const list = host.querySelector<HTMLElement>("[data-list]")!
  const set = (value: ReadonlyArray<string>): void => {
    setItems(value)
    flush()
  }
  return { set, node, list }
}

const rectOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  const tenth = (n: number): number => Math.round(n * 10) / 10
  return { left: tenth(r.left), top: tenth(r.top), right: tenth(r.right), bottom: tenth(r.bottom), width: tenth(r.width), height: tenth(r.height) }
}

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

describe("AnimatePresence's anchorX, anchorY and presenceAffectsLayout on Solid 2 (#442)", () => {
  it("PAV1: the container shrinking and narrowing as it pops: pinned by the bottom right, it keeps those distances", async () => {
    const list = mountList(["a", "b", "c"], {
      mode: "popLayout",
      anchorX: "right",
      anchorY: "bottom",
      listStyle: { position: "relative", width: "fit-content" },
      itemStyle: (item) => ({ width: Bool.match(item === "b", { onTrue: () => "200px", onFalse: () => "100px" }) }),
    })
    await frames(5)
    const b = list.node("b")
    const before = { b: rectOf(b), list: rectOf(list.list) }
    list.set(["a", "c"])
    await raf()
    await raf()
    const after = { b: rectOf(b), list: rectOf(list.list) }
    expect([after.list.width, after.list.height], "the container narrowed and shrank").toEqual([100, before.list.height - 40])
    expect(after.list.right - after.b.right, "from its right").toBe(before.list.right - before.b.right)
    expect(after.list.bottom - after.b.bottom, "from its bottom").toBe(before.list.bottom - before.b.bottom)
  })

  it("PAV2: a child entering pushes a layout sibling, which slides, though the child has no layout node", async () => {
    const list = mountList(["a", "b"], { laid: ["a", "b"] })
    await frames(5)
    const a = list.node("a")
    const aWas = a.getBoundingClientRect().top
    list.set(["z", "a", "b"])
    await raf()
    const sawMid = await slides(a, aWas, aWas + 40, () => Math.abs(a.getBoundingClientRect().top - aWas - 40) < 0.5)
    expect(sawMid, "a slid down").toBe(true)
  })

  it("PAV3: presenceAffectsLayout false: a sibling pushed by a child entering jumps", async () => {
    const list = mountList(["a", "b"], { laid: ["a", "b"], presenceAffectsLayout: false })
    await frames(5)
    const a = list.node("a")
    const aWas = a.getBoundingClientRect().top
    list.set(["z", "a", "b"])
    await raf()
    await raf()
    expect(a.getBoundingClientRect().top, "a at its new place at once").toBeCloseTo(aWas + 40, 0)
  })
})
