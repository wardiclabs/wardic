// `<AnimatePresence mode="wait">` on Solid 2 (#277, ADR-0048), as the Solid 1 binding's WT tests pin
// it: while a child exits, one entering is held off the page, its wards not started, and goes on once
// the last leaver is gone. Real frames, under the diagnostics gate.
//
// - PW1: a switch: the new child is off the page while the old one animates out, then animates in;
//   the handle's `exitComplete` resolves once, the leaver gone.
// - PW2: the held child's own effect runs at once, off the page (Q1 A); a ward spread inside it
//   animates in once it's on the page.
// - PW3: a switch again mid-wait: the child held in between never goes on the page.
// - PW4: the presence unmounted mid-wait: the held child never goes on the page.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createPresence, type Presence, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const EXIT = { type: "tween", duration: 0.15 } as const

const opacityOf = (el: Element | null | undefined): number => Number((el as HTMLElement).style.opacity)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A `mode="wait"` presence around a keyed `<Show>` of Wardic tabs, with its handle. */
const mountTabs = (start: string) => {
  const [tab, setTab] = createSignal<string | undefined>(start)
  let presence!: Presence
  const Tabs = (): JSX.Element => {
    presence = createPresence()
    return (
      <section>
        <AnimatePresence mode="wait" ref={presence}>
          <Show when={tab()} keyed>
            {(t) => (
              <wardic.p data-tab={t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                {t}
              </wardic.p>
            )}
          </Show>
        </AnimatePresence>
      </section>
    )
  }
  const { host, unmount } = mount(() => (
    <WardicProvider env={DomLive}>
      <Tabs />
    </WardicProvider>
  ))
  const node = (t: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-tab="${t}"]`)
  const shownTabs = (): Array<string> => Array.from(host.querySelectorAll<HTMLElement>("[data-tab]")).map((n) => n.dataset.tab!)
  const set = (value: string | undefined): void => {
    setTab(value)
    flush()
  }
  return { set, node, shownTabs, unmount, presence: () => presence }
}

describe('AnimatePresence mode="wait" on Solid 2 (#277)', () => {
  it("PW1: the new child is off the page while the old one exits, then animates in", async () => {
    const tabs = mountTabs("a")
    await until(() => opacityOf(tabs.node("a")) >= 0.99, 2000)
    const a = tabs.node("a")!
    let completes = 0
    void tabs.presence().next("exitComplete").then(() => completes++)
    tabs.set("b")
    expect(tabs.shownTabs(), "only the leaver").toEqual(["a"])
    let sawMid = false
    let bEarly = false
    await until(() => {
      if (a.isConnected && opacityOf(a) > 0.05 && opacityOf(a) < 0.95) sawMid = true
      if (a.isConnected && tabs.node("b") !== null) bEarly = true
      return !a.isConnected && tabs.node("b") !== null
    }, 3000)
    expect(sawMid, "a animated out").toBe(true)
    expect(bEarly, "b never on the page beside a").toBe(false)
    const b = tabs.node("b")!
    expect(opacityOf(b), "from its initial").toBeLessThan(0.5)
    await until(() => opacityOf(b) >= 0.99, 2000)
    expect(opacityOf(b)).toBeGreaterThanOrEqual(0.99)
    expect(completes, "once").toBe(1)
  })

  it("PW2: the held child's own effect runs off the page, and a ward inside it animates in on the page", async () => {
    const [tab, setTab] = createSignal("a")
    const seen: Array<{ readonly tab: string; readonly connected: boolean }> = []
    const Panel = (props: { readonly tab: string }): JSX.Element => {
      const inner = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween", duration: 0.3 } })
      let el!: HTMLDivElement
      createEffect(
        () => props.tab,
        (t) => {
          seen.push({ tab: t, connected: el.isConnected })
        },
      )
      return (
        <wardic.div ref={el} data-tab={props.tab} exit={{ opacity: 0 }} transition={EXIT}>
          <span data-inner={props.tab} {...inner} />
        </wardic.div>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence mode="wait">
          <Show when={tab()} keyed>
            {(t) => <Panel tab={t} />}
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const inner = (t: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-inner="${t}"]`)
    await until(() => opacityOf(inner("a")) >= 0.99, 2000)
    const a = host.querySelector<HTMLElement>('[data-tab="a"]')!
    setTab("b")
    flush()
    await raf()
    expect(seen.at(-1), "b's effect ran, off the page").toEqual({ tab: "b", connected: false })
    await until(() => !a.isConnected, 3000)
    await until(() => inner("b") !== null, 1000)
    const b = inner("b")!
    expect(opacityOf(b), "its entrance not run off the page").toBeLessThan(0.5)
    let sawMid = false
    await until(() => {
      if (opacityOf(b) > 0.05 && opacityOf(b) < 0.95) sawMid = true
      return opacityOf(b) >= 0.99
    }, 2000)
    expect(sawMid, "it animated in on the page").toBe(true)
  })

  it("PW3: a switch again mid-wait: the child held in between never goes on the page", async () => {
    const tabs = mountTabs("a")
    await until(() => opacityOf(tabs.node("a")) >= 0.99, 2000)
    const a = tabs.node("a")!
    tabs.set("b")
    await frames(3)
    tabs.set("c")
    let sawB = false
    await until(() => {
      if (tabs.node("b") !== null) sawB = true
      return !a.isConnected && tabs.node("c") !== null
    }, 3000)
    expect(sawB, "b never on the page").toBe(false)
    expect(tabs.shownTabs()).toEqual(["c"])
    await until(() => opacityOf(tabs.node("c")) >= 0.99, 2000)
    expect(opacityOf(tabs.node("c"))).toBeGreaterThanOrEqual(0.99)
  })

  it("PW4: the presence unmounted mid-wait: the held child never goes on the page", async () => {
    const tabs = mountTabs("a")
    await until(() => opacityOf(tabs.node("a")) >= 0.99, 2000)
    tabs.set("b")
    await frames(3)
    tabs.unmount()
    await frames(20)
    expect(tabs.node("b")).toBeNull()
  })
})
