// A keyed presence child's take-over and layout on Solid 1 (#286's PR 2, ADR-0048): a `layout` one
// back elsewhere moves there from where its leaver painted, and a keyed `layoutId` twin back while
// it crossfades out goes on from where its leaver had faded (Q8: D, Motion's same element).
// Real frames, read just after each paint.
//
// - KL1: a `layout` item back elsewhere in the list glides from where the leaver painted.
// - KL2: without `layout`, it's drawn in its own place at once.
// - KL3: back in its own place: nothing moves.
// - KL4: `mode="popLayout"`: it glides from the popped leaver's box.
// - KL5: a `layout` element inside starts where the one it pairs with painted.
// - KL6: a keyed twin back mid-crossfade: its leaver goes at once, uncompleted, and it fades on from
//   where that one had faded to, not from 0 nor from 1.
// - KL7: on a scrolled page, from where the leaver painted all the same (the Root frame).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, paintedFrames, until } from "./browser-helpers.ts"

afterEach(cleanup)

const SLOW = { type: "tween", duration: 0.6 } as const
const CROSSFADE = { type: "tween", duration: 1.2 } as const
const ROW = { display: "block", height: "30px", margin: "0", padding: "0" } as const

/** The end of the task: a take-over's values are drawn there, before any paint. */
const endOfTask = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve))

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)
const topOf = (el: Element): number => el.getBoundingClientRect().top

/** A presence around a `<For>` of keyed 30px rows. */
const mountRows = (start: ReadonlyArray<string>, row: (id: string) => JSX.Element, mode?: PresenceMode) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <ul style={{ margin: "0", padding: "0", "list-style": "none", position: "relative" }}>
        <AnimatePresence mode={mode}>
          <For each={items()}>{row}</For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  const all = (id: string): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>(`[data-item="${id}"]`))
  const node = (id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${id}"]`)!
  return { setItems, all, node, container }
}

/** A keyed row that fades, with `layout` or without. */
const rowOf =
  (layout: boolean) =>
  (id: string): JSX.Element =>
    Bool.match(layout, {
      onTrue: () => (
        <wardic.li key={id} layout data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={ROW}>
          {id}
        </wardic.li>
      ),
      onFalse: () => (
        <wardic.li key={id} data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={ROW}>
          {id}
        </wardic.li>
      ),
    })

/** Remove `b` from `[a, b, c]`, wait for it to be mid-exit, and return where it paints. */
const removeMidExit = async (rows: ReturnType<typeof mountRows>, rest: ReadonlyArray<string>): Promise<{ readonly leaver: HTMLElement; readonly top: number }> => {
  await until(() => opacityOf(rows.node("c")) >= 0.99, 3000)
  const leaver = rows.node("b")
  rows.setItems(rest)
  await until(() => opacityOf(leaver) < 0.7 && opacityOf(leaver) > 0.3, 3000)
  expect(opacityOf(leaver), "mid-exit").toBeLessThan(0.7)
  await afterPaint()
  return { leaver, top: topOf(leaver) }
}

describe("a keyed presence child's take-over and layout on Solid 1 (#286's PR 2)", () => {
  it("KL1: a layout item back elsewhere in the list glides from where the leaver painted", async () => {
    const rows = mountRows(["a", "b", "c"], rowOf(true))
    const { leaver, top } = await removeMidExit(rows, ["a", "c"])
    rows.setItems(["a", "c", "b"])
    await endOfTask()
    expect(leaver.isConnected, "the leaver went").toBe(false)
    const back = rows.node("b")
    const frames = await paintedFrames(back, 3)
    expect(Math.abs(frames[0]!.top - top), "first painted where the leaver was").toBeLessThan(3)
    const slot = topOf(rows.node("c")) + 30
    await until(() => Math.abs(topOf(back) - topOf(rows.node("c")) - 30) < 0.5, 3000)
    expect(topOf(back) - topOf(rows.node("c")), "then at its own place, under c").toBeCloseTo(30, 0)
    expect(slot).toBeGreaterThan(top)
  })

  it("KL2: without layout, it's drawn in its own place at once", async () => {
    const rows = mountRows(["a", "b", "c"], rowOf(false))
    const { top } = await removeMidExit(rows, ["a", "c"])
    rows.setItems(["a", "c", "b"])
    await endOfTask()
    const back = rows.node("b")
    const frames = await paintedFrames(back, 2)
    expect(frames[0]!.top, "at its own place, under c").toBeCloseTo(topOf(rows.node("c")) + 30, 0)
    expect(frames[0]!.top).not.toBeCloseTo(top, 0)
  })

  it("KL3: back in its own place: nothing moves", async () => {
    const rows = mountRows(["a", "b", "c"], rowOf(true))
    const { top } = await removeMidExit(rows, ["a", "c"])
    rows.setItems(["a", "b", "c"])
    await endOfTask()
    const frames = await paintedFrames(rows.node("b"), 4)
    for (const frame of frames) expect(frame.top, "where it was, every frame").toBeCloseTo(top, 0)
  })

  it("KL4: mode=popLayout: it glides from the popped leaver's box", async () => {
    const rows = mountRows(["a", "b", "c"], rowOf(true), "popLayout")
    const { leaver, top } = await removeMidExit(rows, ["a", "c"])
    expect(leaver.style.position, "popped").toBe("absolute")
    rows.setItems(["a", "c", "b"])
    await endOfTask()
    const back = rows.node("b")
    const frames = await paintedFrames(back, 2)
    expect(Math.abs(frames[0]!.top - top), "first painted where the popped leaver was").toBeLessThan(3)
    await until(() => Math.abs(topOf(back) - topOf(rows.node("c")) - 30) < 0.5, 3000)
    expect(topOf(back) - topOf(rows.node("c"))).toBeCloseTo(30, 0)
  })

  it("KL5: a layout element inside starts where the one it pairs with painted, moved within its row", async () => {
    const [shifted, setShifted] = createSignal(false)
    const withBadge = (id: string): JSX.Element => (
      <wardic.li key={id} layout data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={ROW}>
        <wardic.span
          layout
          data-badge={id}
          transition={SLOW}
          style={{ display: "inline-block", width: "10px", height: "10px", "margin-left": Bool.match(shifted(), { onTrue: () => "100px", onFalse: () => "0px" }) }}
        />
      </wardic.li>
    )
    const rows = mountRows(["a", "b", "c"], withBadge)
    const badge = (id: string): HTMLElement => rows.container.querySelector<HTMLElement>(`[data-badge="${id}"]`)!
    const old = badge("b")
    await removeMidExit(rows, ["a", "c"])
    const oldLeft = old.getBoundingClientRect().left
    // The new row's badge is 100px further right in its row: it starts where the old one was.
    setShifted(true)
    rows.setItems(["a", "c", "b"])
    await endOfTask()
    const back = badge("b")
    const frames = await paintedFrames(back, 2)
    expect(Math.abs(frames[0]!.left - oldLeft), "first painted where the old badge was").toBeLessThan(3)
    await until(() => Math.abs(back.getBoundingClientRect().left - oldLeft - 100) < 0.5, 3000)
    expect(back.getBoundingClientRect().left - oldLeft, "then at its own place in its row").toBeCloseTo(100, 0)
  })

  it("KL6: a keyed twin back mid-crossfade fades on from where its leaver had faded to", async () => {
    const [open, setOpen] = createSignal(false)
    let completes = 0
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "300px" }}>
          <wardic.div layoutId="card" data-k="item" transition={CROSSFADE} style={{ width: "40px", height: "40px", background: "red" }} />
          <AnimatePresence onExitComplete={() => completes++}>
            <Show when={open()}>
              <wardic.div key="card" layoutId="card" data-k="modal" transition={CROSSFADE} style={{ position: "absolute", left: "100px", top: "100px", width: "160px", height: "160px", background: "blue" }} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    const modals = (): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>('[data-k="modal"]'))
    // Read just after the next paint.
    const paintedFade = (el: HTMLElement): Promise<number> =>
      new Promise((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          channel.port1.close()
          resolve(Number(getComputedStyle(el).opacity))
        }
        requestAnimationFrame(() => channel.port2.postMessage(undefined))
      })
    const fadeOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
    await afterPaint()
    setOpen(true)
    await until(() => modals().length === 1 && fadeOf(modals()[0]!) >= 0.99, 3000)
    await afterPaint()
    const old = modals()[0]!
    setOpen(false)
    // A Follower holds until half way, then fades: caught between 0.6 and 0.72.
    await until(() => old.isConnected && fadeOf(old) < 0.72 && fadeOf(old) > 0.6, 4000)
    const faded = fadeOf(old)
    expect(faded, "crossfading out").toBeLessThan(0.72)
    expect(faded, "crossfading out").toBeGreaterThan(0.6)
    setOpen(true)
    await endOfTask()
    expect(old.isConnected, "its leaving Follower went at once").toBe(false)
    expect(modals().length, "one modal").toBe(1)
    const back = modals()[0]!
    // From 0, a Lead's first frame reads under 0.5; from 1, 1.
    const first = await paintedFade(back)
    expect(first, "fading on from where the leaver was, not from 0").toBeGreaterThan(faded - 0.1)
    expect(first, "nor from 1").toBeLessThan(faded + 0.25)
    await until(() => fadeOf(back) >= 0.99, 3000)
    expect(fadeOf(back)).toBeGreaterThanOrEqual(0.99)
    expect(completes, "no completion").toBe(0)
  })

  it("KL7: on a scrolled page, from where the leaver painted all the same", async () => {
    const above = document.createElement("div")
    above.style.height = "200px"
    const below = document.createElement("div")
    below.style.height = "3000px"
    try {
      const rows = mountRows(["a", "b", "c"], rowOf(true))
      rows.container.before(above)
      rows.container.after(below)
      window.scrollTo(0, 60)
      await afterPaint()
      expect(window.scrollY, "scrolled").toBeGreaterThan(50)
      // In the page's coordinates: the browser may move the scroll as the leaver goes (scroll anchoring).
      const { top } = await removeMidExit(rows, ["a", "c"])
      const pageTop = top + window.scrollY
      rows.setItems(["a", "c", "b"])
      await endOfTask()
      const frames = await paintedFrames(rows.node("b"), 2)
      expect(Math.abs(frames[0]!.top + window.scrollY - pageTop), "first painted where the leaver was").toBeLessThan(3)
    } finally {
      window.scrollTo(0, 0)
      above.remove()
      below.remove()
    }
  })
})
