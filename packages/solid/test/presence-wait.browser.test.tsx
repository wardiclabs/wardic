// `<AnimatePresence mode="wait">` on Solid 1 (#277, ADR-0048): while a child exits, one entering is
// held off the page, its Wardic elements not started, and goes on once the last leaver is gone.
// Real frames.
//
// - WT1: a switch: the new child is off the page while the old one animates out, then goes on and
//   animates in from its `initial`; `onExitComplete` is called before it's on the page.
// - WT2: the held child's own code runs at once, off the page (Q1 A): its `onMount` sees no parent.
// - WT3: a Wardic element inside the held child waits too: it animates in once on the page.
// - WT4: a switch again mid-wait: the child held in between never goes on the page; the last one
//   enters after the leaver, and `onExitComplete` is called once.
// - WT5: the old child back mid-exit: a new node, held until the old one has gone.
// - WT6: nothing to wait for: a plain (non-Wardic) leaver, and one with no `exit`, let the new child
//   on at once.
// - WT7: `sync`, the default: the new child is on the page at once, beside the leaver.
// - WT8: a list under `wait`: items added while another exits are held, their entrances not run
//   off the page through a change mid-wait; the item that stays stays, at rest.
// - WT9: the presence unmounted mid-wait: the held child never goes on the page.
// - WT10: `mode` changed to `sync` mid-wait: the held child goes on at once.
// - WT11: a `layoutId` twin in the held child enters in its place, with no handover: its leaver's
//   record ended with the task it left in (ADR-0010), before the twin goes on.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, onMount, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const EXIT = { type: "tween", duration: 0.15 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** A presence around a keyed `<Show>`: one tab at a time, each a Wardic element that fades. */
const mountTabs = (start: string | undefined, options: { readonly mode?: PresenceMode; readonly exit?: boolean; readonly plain?: boolean } = {}) => {
  const [tab, setTab] = createSignal<string | undefined>(start)
  const [mode, setMode] = createSignal<PresenceMode | undefined>(options.mode)
  const completes: Array<boolean> = []
  const mounts: Array<{ readonly tab: string; readonly connected: boolean }> = []
  const Tab = (props: { readonly tab: string }): JSX.Element => {
    let el!: HTMLParagraphElement
    onMount(() => mounts.push({ tab: props.tab, connected: el.isConnected }))
    const exit = Bool.match(options.exit === false, { onTrue: () => ({}), onFalse: () => ({ exit: { opacity: 0 } }) })
    return Bool.match(options.plain === true, {
      onTrue: () => (
        <p ref={el} data-tab={props.tab}>
          {props.tab}
        </p>
      ),
      onFalse: () => (
        <wardic.p ref={el} data-tab={props.tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} {...exit} transition={EXIT}>
          {props.tab}
        </wardic.p>
      ),
    })
  }
  const { container, unmount } = render(() => (
    <WardicProvider env={DomLive}>
      <section>
        <AnimatePresence mode={mode()} onExitComplete={() => completes.push(Boolean(container.querySelector("[data-tab]:not([data-tab='a'])")))}>
          <Show when={tab()} keyed>
            {(t) => <Tab tab={t} />}
          </Show>
        </AnimatePresence>
      </section>
    </WardicProvider>
  ))
  const shownTabs = (): Array<string> => Array.from(container.querySelectorAll<HTMLElement>("[data-tab]")).map((n) => n.dataset.tab!)
  const node = (t: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-tab="${t}"]`)
  return { setTab, setMode, completes, mounts, shownTabs, node, unmount }
}

describe('AnimatePresence mode="wait" on Solid 1 (#277)', () => {
  it("WT1: the new child is off the page while the old one exits, then animates in", async () => {
    const tabs = mountTabs("a", { mode: "wait" })
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    const a = tabs.node("a")!
    tabs.setTab("b")
    expect(tabs.shownTabs(), "only the leaver").toEqual(["a"])
    let sawMid = false
    let bEarly = false
    await until(() => {
      if (a.isConnected && opacityOf(a) > 0.05 && opacityOf(a) < 0.95) sawMid = true
      if (a.isConnected && tabs.node("b") !== null) bEarly = true
      return !a.isConnected
    }, 3000)
    expect(sawMid, "a animated out").toBe(true)
    expect(bEarly, "b never on the page beside a").toBe(false)
    expect(tabs.completes, "called once, before b went on").toEqual([false])
    const b = tabs.node("b")
    expect(b, "b on the page once a's gone").not.toBeNull()
    expect(opacityOf(b!), "from its initial").toBeLessThan(0.5)
    await until(() => opacityOf(b!) >= 0.99, 2000)
    expect(opacityOf(b!)).toBeGreaterThanOrEqual(0.99)
  })

  it("WT2: the held child's own code runs at once, off the page", async () => {
    const tabs = mountTabs("a", { mode: "wait" })
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    tabs.setTab("b")
    await raf()
    expect(tabs.mounts.at(-1), "b's onMount ran, off the page").toEqual({ tab: "b", connected: false })
    expect(tabs.node("b")).toBeNull()
  })

  it("WT3: a Wardic element inside the held child animates in once it's on the page", async () => {
    const [tab, setTab] = createSignal("a")
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence mode="wait">
          <Show when={tab()} keyed>
            {(t) => (
              <wardic.div data-tab={t} exit={{ opacity: 0 }} transition={EXIT}>
                <wardic.span data-inner={t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: 0.3 }}>
                  {t}
                </wardic.span>
              </wardic.div>
            )}
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const inner = (t: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-inner="${t}"]`)
    await until(() => opacityOf(inner("a")!) >= 0.99, 2000)
    const a = container.querySelector<HTMLElement>('[data-tab="a"]')!
    setTab("b")
    await until(() => !a.isConnected, 3000)
    expect(a.isConnected).toBe(false)
    const b = inner("b")
    expect(b).not.toBeNull()
    expect(opacityOf(b!), "its entrance not run off the page").toBeLessThan(0.5)
    let sawMid = false
    await until(() => {
      if (opacityOf(b!) > 0.05 && opacityOf(b!) < 0.95) sawMid = true
      return opacityOf(b!) >= 0.99
    }, 2000)
    expect(sawMid, "it animated in on the page").toBe(true)
  })

  it("WT4: a switch again mid-wait: the child held in between never goes on the page", async () => {
    const tabs = mountTabs("a", { mode: "wait" })
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    const a = tabs.node("a")!
    tabs.setTab("b")
    await frames(3)
    tabs.setTab("c")
    let sawB = false
    await until(() => {
      if (tabs.node("b") !== null) sawB = true
      return !a.isConnected && tabs.node("c") !== null
    }, 3000)
    expect(sawB, "b never on the page").toBe(false)
    expect(tabs.shownTabs()).toEqual(["c"])
    await until(() => opacityOf(tabs.node("c")!) >= 0.99, 2000)
    await frames(5)
    expect(tabs.completes, "once").toEqual([false])
    expect(tabs.shownTabs()).toEqual(["c"])
  })

  it("WT5: the old child back mid-exit: a new node, held until the old one has gone", async () => {
    const tabs = mountTabs("a", { mode: "wait" })
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    const old = tabs.node("a")!
    tabs.setTab(undefined)
    await frames(3)
    tabs.setTab("a")
    expect(tabs.shownTabs(), "the old one alone").toEqual(["a"])
    expect(tabs.node("a")).toBe(old)
    await until(() => !old.isConnected, 3000)
    const fresh = tabs.node("a")
    expect(fresh, "a new node, once the old one's gone").not.toBeNull()
    expect(fresh).not.toBe(old)
    await until(() => opacityOf(fresh!) >= 0.99, 2000)
    expect(opacityOf(fresh!)).toBeGreaterThanOrEqual(0.99)
  })

  it("WT6: a plain leaver, or one with no exit, lets the new child on at once", async () => {
    const plain = mountTabs("a", { mode: "wait", plain: true })
    await frames(2)
    plain.setTab("b")
    await raf()
    expect(plain.shownTabs(), "plain").toEqual(["b"])
    plain.unmount()

    const bare = mountTabs("a", { mode: "wait", exit: false })
    await until(() => opacityOf(bare.node("a")!) >= 0.99, 2000)
    bare.setTab("b")
    await raf()
    expect(bare.shownTabs(), "no exit").toEqual(["b"])
  })

  it("WT7: sync, the default: the new child is on the page at once, beside the leaver", async () => {
    const tabs = mountTabs("a")
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    tabs.setTab("b")
    expect(tabs.shownTabs().sort()).toEqual(["a", "b"])
    expect(tabs.mounts.at(-1)).toEqual({ tab: "b", connected: true })
  })

  it("WT8: a list under wait: an item added while another exits is held; the others stay", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <ul>
          <AnimatePresence mode="wait">
            <For each={items()}>
              {(item) => (
                <wardic.li data-item={item} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                  {item}
                </wardic.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    const order = (): Array<string> => Array.from(container.querySelectorAll<HTMLElement>("[data-item]")).map((n) => n.dataset.item!)
    const node = (item: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${item}"]`)!
    await until(() => order().every((item) => opacityOf(node(item)) >= 0.99), 2000)
    const a = node("a")
    const b = node("b")
    setItems(["b", "c"])
    expect(order(), "c held, b stays").toEqual(["a", "b"])
    await frames(3)
    // A change mid-wait: d held too, and c's ward still waits.
    setItems(["b", "c", "d"])
    let bLeft = false
    await until(() => {
      if (Bool.or(Bool.not(b.isConnected), opacityOf(b) < 0.99)) bLeft = true
      return !a.isConnected
    }, 3000)
    expect(bLeft, "b stayed, at rest").toBe(false)
    expect(node("b")).toBe(b)
    await until(() => order().length === 3, 1000)
    expect(order()).toEqual(["b", "c", "d"])
    expect(opacityOf(node("c")), "c's entrance not run off the page").toBeLessThan(0.5)
    await until(() => opacityOf(node("d")) >= 0.99, 2000)
    expect(opacityOf(node("c"))).toBeGreaterThanOrEqual(0.99)
  })

  it("WT9: the presence unmounted mid-wait: the held child never goes on the page", async () => {
    const tabs = mountTabs("a", { mode: "wait" })
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    tabs.setTab("b")
    await frames(3)
    tabs.unmount()
    await frames(20)
    expect(tabs.node("b")).toBeNull()
    expect(tabs.completes).toEqual([])
  })

  it("WT10: mode changed to sync mid-wait: the held child goes on at once", async () => {
    const tabs = mountTabs("a", { mode: "wait" })
    await until(() => opacityOf(tabs.node("a")!) >= 0.99, 2000)
    const a = tabs.node("a")!
    tabs.setTab("b")
    await frames(3)
    expect(tabs.node("b")).toBeNull()
    tabs.setMode("sync")
    await raf()
    expect(a.isConnected, "a still exiting").toBe(true)
    const b = tabs.node("b")
    expect(b, "b on the page").not.toBeNull()
    await until(() => opacityOf(b!) >= 0.99, 2000)
    expect(opacityOf(b!)).toBeGreaterThanOrEqual(0.99)
  })

  it("WT11: a layoutId twin in the held child enters in its place, with no handover", async () => {
    const [tab, setTab] = createSignal("a")
    const left = (t: string): string => Bool.match(t === "a", { onTrue: () => "0px", onFalse: () => "300px" })
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "400px", height: "100px" }}>
          <AnimatePresence mode="wait">
            <Show when={tab()} keyed>
              {(t) => (
                <wardic.div
                  data-tab={t}
                  layoutId="card"
                  exit={{ opacity: 0 }}
                  transition={EXIT}
                  style={{ position: "absolute", top: "0px", left: left(t), width: "50px", height: "50px" }}
                />
              )}
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(10)
    const a = container.querySelector<HTMLElement>('[data-tab="a"]')!
    setTab("b")
    await until(() => !a.isConnected && container.querySelector('[data-tab="b"]') !== null, 3000)
    const b = container.querySelector<HTMLElement>('[data-tab="b"]')!
    const lefts: Array<number> = []
    for (let i = 0; i < 6; i++) {
      lefts.push(Math.round(b.getBoundingClientRect().left - container.getBoundingClientRect().left))
      await raf()
    }
    expect(lefts, "in its place from the first frame").toEqual([300, 300, 300, 300, 300, 300])
  })
})
