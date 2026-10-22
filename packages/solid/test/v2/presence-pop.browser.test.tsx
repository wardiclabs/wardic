// `<AnimatePresence mode="popLayout">` on Solid 2 (#277, ADR-0048), as the Solid 1 binding's PL tests
// pin it, and the projection told when a leaver is removed. Real frames, under the diagnostics gate.
//
// - PP1: a leaver is popped out of the flow where it was, and a `layout` sibling slides into its space.
// - PP2: `sync` (the gap fix): once the leaver is removed, a `layout` sibling slides into the gap.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const EXIT = { type: "tween", duration: 0.3 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A presence around a `<For>` of 40px `layout` items that fade out. */
const mountList = (start: ReadonlyArray<string>, mode: PresenceMode) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <ul style={{ margin: "0", padding: "0", "list-style": "none" }}>
        <AnimatePresence mode={mode}>
          <For each={items()}>
            {(item) => (
              <wardic.li data-item={item} layout exit={{ opacity: 0 }} transition={EXIT} style={{ display: "block", height: "40px" }}>
                {item}
              </wardic.li>
            )}
          </For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  const node = (item: string): HTMLElement => host.querySelector<HTMLElement>(`[data-item="${item}"]`)!
  const set = (value: ReadonlyArray<string>): void => {
    setItems(value)
    flush()
  }
  return { set, node }
}

/** Watch `el`'s top until `done`: whether it was seen strictly between `from` and `to`. */
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

describe('AnimatePresence mode="popLayout" on Solid 2 (#277)', () => {
  it("PP1: popped where it was, and a layout sibling slides into its space", async () => {
    const list = mountList(["a", "b", "c"], "popLayout")
    await frames(5)
    const b = list.node("b")
    const c = list.node("c")
    const bWas = b.getBoundingClientRect()
    const cWas = c.getBoundingClientRect().top
    list.set(["a", "c"])
    expect(getComputedStyle(b).position).toBe("absolute")
    expect(b.getBoundingClientRect().top).toBeCloseTo(bWas.top, 1)
    // The Measure pass runs at the end of the task, before the frame paints.
    await raf()
    const sawMid = await slides(c, cWas, bWas.top, () => Math.abs(c.getBoundingClientRect().top - bWas.top) < 0.5)
    expect(sawMid, "c slid into b's space").toBe(true)
    expect(b.isConnected, "b still exiting as c lands").toBe(true)
  })

  it("PP2: sync: once the leaver is removed, a layout sibling slides into the gap", async () => {
    const list = mountList(["a", "b", "c"], "sync")
    await frames(5)
    const b = list.node("b")
    const c = list.node("c")
    const bTop = b.getBoundingClientRect().top
    const cWas = c.getBoundingClientRect().top
    list.set(["a", "c"])
    await until(() => !b.isConnected, 3000)
    const sawMid = await slides(c, cWas, bTop, () => Math.abs(c.getBoundingClientRect().top - bTop) < 0.5)
    expect(sawMid, "c slid into the gap").toBe(true)
  })
})
