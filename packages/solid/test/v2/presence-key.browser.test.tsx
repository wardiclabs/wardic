// `key` on a Wardic element under `<AnimatePresence>` on Solid 2 (#286, ADR-0048), as the Solid 1
// binding's PK tests pin it. Real frames, under the diagnostics gate.
//
// - KV1: back mid-exit: one node at once, from where the leaver was drawn, then at its animate.
// - KV2: `mode="wait"` doesn't hold a child back under its key.
// - KV3: the presence's handle: `exiting()` off at the take-over, and no `exitComplete`.
// - KV4 (#286's PR 2): a `layout` item back elsewhere in the list glides from where the leaver painted.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createPresence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, paintedFrames, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const EXIT = { type: "tween", duration: 0.4 } as const

/** The end of the task: a take-over's values are drawn there, before any paint. */
const endOfTask = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve))

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** Wait for `el` to be mid-exit. */
const midExit = async (el: HTMLElement): Promise<void> => {
  await until(() => opacityOf(el) > 0.3 && opacityOf(el) < 0.7, 2000)
  expect(opacityOf(el), "mid-exit").toBeGreaterThan(0.3)
  expect(opacityOf(el), "mid-exit").toBeLessThan(0.7)
}

describe("AnimatePresence key on Solid 2 (#286)", () => {
  it("KV1: back mid-exit: one node at once, from where the leaver was drawn, then at its animate", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <ul>
          <AnimatePresence>
            <For each={items()}>
              {(id) => (
                <wardic.li key={id} data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                  {id}
                </wardic.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    const all = (id: string): Array<HTMLElement> => Array.from(host.querySelectorAll<HTMLElement>(`[data-item="${id}"]`))
    await until(() => all("b").length === 1 && opacityOf(all("b")[0]!) >= 0.99, 2000)
    const b = all("b")[0]!
    setItems(["a"])
    flush()
    await midExit(b)
    const at = opacityOf(b)
    setItems(["a", "b"])
    flush()
    await endOfTask()
    expect(b.isConnected, "the leaver went at once").toBe(false)
    expect(all("b").length, "one node").toBe(1)
    const back = all("b")[0]!
    expect(opacityOf(back), "drawn where the leaver was").toBeCloseTo(at, 1)
    expect(back.hasAttribute("key"), "key isn't an attribute").toBe(false)
    await until(() => opacityOf(back) >= 0.99, 2000)
    expect(opacityOf(back)).toBeGreaterThanOrEqual(0.99)
  })

  it("KV2: mode=wait doesn't hold a child back under its key", async () => {
    const [tab, setTab] = createSignal("home")
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <section>
          <AnimatePresence mode="wait">
            <Show when={tab()} keyed>
              {(t) => (
                <wardic.p key={t} data-tab={t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                  {t}
                </wardic.p>
              )}
            </Show>
          </AnimatePresence>
        </section>
      </WardicProvider>
    ))
    const tabs = (t: string): Array<HTMLElement> => Array.from(host.querySelectorAll<HTMLElement>(`[data-tab="${t}"]`))
    await until(() => tabs("home").length === 1 && opacityOf(tabs("home")[0]!) >= 0.99, 2000)
    const home = tabs("home")[0]!
    setTab("settings")
    flush()
    expect(tabs("settings").length, "held off the page").toBe(0)
    await midExit(home)
    setTab("home")
    flush()
    await endOfTask()
    expect(home.isConnected, "the leaver went").toBe(false)
    expect(tabs("home").length, "back at once, not held").toBe(1)
    await frames(30)
    expect(tabs("settings").length, "never shown").toBe(0)
  })

  it("KV3: the presence's handle: exiting() off at the take-over, and no exitComplete", async () => {
    const [shown, setShown] = createSignal(true)
    let presence!: ReturnType<typeof createPresence>
    let completed = false
    const Scene = () => {
      presence = createPresence()
      // Rejected as the test's owner goes, with no completion: caught.
      presence.next("exitComplete").then(
        () => {
          completed = true
        },
        () => {},
      )
      return (
        <AnimatePresence ref={presence}>
          <Show when={shown()}>
            <wardic.div key="only" data-child initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    const child = (): HTMLElement => host.querySelector<HTMLElement>("[data-child]")!
    await until(() => opacityOf(child()) >= 0.99, 2000)
    const old = child()
    setShown(false)
    flush()
    await midExit(old)
    expect(presence.exiting(), "exiting").toBe(true)
    setShown(true)
    flush()
    await endOfTask()
    expect(old.isConnected).toBe(false)
    expect(presence.exiting(), "off at the take-over").toBe(false)
    await frames(40)
    expect(completed, "no completion").toBe(false)
  })

  it("KV4: a layout item back elsewhere in the list glides from where the leaver painted", async () => {
    const SLOW = { type: "tween", duration: 0.6 } as const
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <ul style={{ margin: "0", padding: "0", "list-style": "none" }}>
          <AnimatePresence>
            <For each={items()}>
              {(id) => (
                <wardic.li
                  key={id}
                  layout
                  data-item={id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={SLOW}
                  style={{ display: "block", height: "30px", margin: "0" }}
                >
                  {id}
                </wardic.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    const node = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-item="${id}"]`)!
    const topOf = (el: Element): number => el.getBoundingClientRect().top
    await until(() => opacityOf(node("c")) >= 0.99, 3000)
    const leaver = node("b")
    setItems(["a", "c"])
    flush()
    await until(() => opacityOf(leaver) < 0.7 && opacityOf(leaver) > 0.3, 3000)
    await afterPaint()
    const top = topOf(leaver)
    setItems(["a", "c", "b"])
    flush()
    await endOfTask()
    expect(leaver.isConnected).toBe(false)
    const back = node("b")
    const painted = await paintedFrames(back, 2)
    expect(Math.abs(painted[0]!.top - top), "first painted where the leaver was").toBeLessThan(3)
    await until(() => Math.abs(topOf(back) - topOf(node("c")) - 30) < 0.5, 3000)
    expect(topOf(back) - topOf(node("c")), "then under c").toBeCloseTo(30, 0)
  })
})
