// `<AnimatePresence mode="popLayout">` on Solid 2 (#277, ADR-0048), as the Solid 1 binding's PL tests
// pin it, and the projection told when a leaver is removed. Real frames, under the diagnostics gate.
//
// - PP1: a leaver is popped out of the flow where it was, and a `layout` sibling slides into its space.
// - PP2: `sync` (the gap fix): once the leaver is removed, a `layout` sibling slides into the gap.
// - PP3 (#407): a `layout="position"` leaver popped out of a shrinking positioned `layout` card, as the
//   storefront's questions, is drawn where it was, at its own size, every frame of its exit.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

// The exit (the transition, #277) outlasts the siblings' layout slide (its `layout` key): the leaver
// still exits as they land.
const EXIT = { type: "tween", duration: 0.8, layout: { type: "tween", duration: 0.3 } } as const

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

  it("PP3: a layout leaver popped out of a shrinking card is drawn where it was, at its own size, every frame (#407)", async () => {
    const [open, setOpen] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-card layout transition={{ type: "tween", duration: 0.5 }} style={{ position: "relative", width: "200px" }}>
          <div style={{ height: "40px" }}>question</div>
          <AnimatePresence mode="popLayout" initial={false}>
            <Show when={open()}>
              <wardic.div data-answer layout="position" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.4 }} style={{ width: "120px", height: "60px" }}>
                answer
              </wardic.div>
            </Show>
          </AnimatePresence>
        </wardic.div>
      </WardicProvider>
    ))
    await frames(5)
    const card = host.querySelector<HTMLElement>("[data-card]")!
    const answer = host.querySelector<HTMLElement>("[data-answer]")!
    const was = answer.getBoundingClientRect()
    setOpen(false)
    flush()
    let shrinking = 0
    await until(() => {
      if (!answer.isConnected) return true
      if (getComputedStyle(card).transform !== "none") shrinking++
      const now = answer.getBoundingClientRect()
      expect(now.height, "its own size").toBeCloseTo(was.height, 0)
      expect(now.top, "where it was").toBeCloseTo(was.top, 0)
      return false
    }, 3000)
    expect(shrinking, "frames the card shrank around it").toBeGreaterThan(5)
    expect(answer.isConnected, "gone at its exit's end").toBe(false)
  })
})
