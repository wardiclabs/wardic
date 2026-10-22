// `key` on a Wardic element under `<AnimatePresence>` on Solid 1 (#286, ADR-0048, Motion's): a child
// back while one with its key is still exiting takes over from it. The leaver goes at once, and the
// new node starts where the leaver is drawn, at its velocities, animating to its own `animate`.
// Real frames.
//
// - PK1: Motion's case: one node at once, starting where the leaver was drawn, then at its animate.
// - PK2: a spring's velocity carries over: the new node keeps going the leaver's way before it turns.
// - PK3: a Variant child inside starts where the one it pairs with in the leaver was drawn.
// - PK4: inside, a different shape (another Wardic element): only the child takes over.
// - PK5: no `onExitComplete` for a take-over.
// - PK6: `mode="wait"` doesn't hold a child back under its key; the one held for it never shows.
// - PK7: `mode="popLayout"`: the new node is in the flow, the popped leaver gone.
// - PK8: a list rebuilt in one change, same keys: nothing exits, each new node where its old one was.
// - PK9: a `usePresence` holding the leaver doesn't keep it: it goes at the take-over.
// - PK10: two leavers with one key: the latest is taken over, the other keeps exiting.
// - PK11: a `key` inside the child, not on it, does nothing: both show.
// - PK12: `key` never reaches the DOM.
// - PK13: back after its leaver went: it enters from its `initial`.
// - PK14: a key the leaver drew and no layer sets now returns to its Base value from there.
// - PK15: `onAnimationStart` once for the new node, with its `animate`.
// - PK16: a tween's velocity, measured from its frames, carries over into a spring.
// - PK17: `use:wardic`'s `key` takes over too.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, usePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

// `use:wardic` needs the import to stay (the directive compiles to a bare `wardic(...)`).
void wardic

const EXIT = { type: "tween", duration: 0.4 } as const

/** The end of the task: a take-over's values are drawn there, before any paint. */
const endOfTask = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve))

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)
const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41

/** A presence around a `<For>` of keyed Wardic items; `render` makes each. */
const mountList = (start: ReadonlyArray<string>, item: (id: string) => JSX.Element, options: { readonly mode?: PresenceMode } = {}) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  let completes = 0
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <ul>
        <AnimatePresence mode={options.mode} onExitComplete={() => completes++}>
          <For each={items()}>{item}</For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  const all = (id: string): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>(`[data-item="${id}"]`))
  const node = (id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${id}"]`)!
  const order = (): Array<string> => Array.from(container.querySelectorAll<HTMLElement>("[data-item]")).map((n) => n.dataset.item!)
  return { setItems, all, node, order, container, completes: () => completes }
}

/** A keyed item that fades in and out. */
const fading = (id: string): JSX.Element => (
  <wardic.li key={id} data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
    {id}
  </wardic.li>
)

/** Wait for `el` to be between `low` and `high` (opacity), mid-exit. */
const midExit = async (el: HTMLElement, low = 0.3, high = 0.7): Promise<void> => {
  await until(() => opacityOf(el) > low && opacityOf(el) < high, 2000)
  expect(opacityOf(el), "mid-exit").toBeGreaterThan(low)
  expect(opacityOf(el), "mid-exit").toBeLessThan(high)
}

describe("AnimatePresence key on Solid 1 (#286)", () => {
  it("PK1: back mid-exit: one node at once, from where the leaver was drawn, then at its animate", async () => {
    const list = mountList(["a", "b", "c"], fading)
    await until(() => opacityOf(list.node("c")) >= 0.99, 2000)
    const b = list.node("b")
    list.setItems(["a", "c"])
    await midExit(b)
    const at = opacityOf(b)
    list.setItems(["a", "b", "c"])
    await endOfTask()
    expect(b.isConnected, "the leaver went at once").toBe(false)
    expect(list.all("b").length, "one node").toBe(1)
    const back = list.node("b")
    expect(back).not.toBe(b)
    expect(opacityOf(back), "drawn where the leaver was, before any frame").toBeCloseTo(at, 1)
    expect(list.order()).toEqual(["a", "b", "c"])
    await frames(2)
    expect(opacityOf(back), "on its way up, not from its initial").toBeGreaterThan(at - 0.05)
    await until(() => opacityOf(back) >= 0.99, 2000)
    expect(opacityOf(back)).toBeGreaterThanOrEqual(0.99)
  })

  it("PK2: a spring's velocity carries over: the new node keeps going the leaver's way first", async () => {
    const SPRING = { type: "spring", stiffness: 60, damping: 12 } as const
    const sliding = (id: string): JSX.Element => (
      <wardic.li key={id} data-item={id} initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 400 }} transition={SPRING} style={{ display: "block", width: "40px" }}>
        {id}
      </wardic.li>
    )
    const list = mountList(["a"], sliding)
    await frames(3)
    const a = list.node("a")
    list.setItems([])
    await until(() => xOf(a) > 40, 2000)
    expect(xOf(a), "moving out").toBeGreaterThan(40)
    list.setItems(["a"])
    await endOfTask()
    const back = list.node("a")
    const at = xOf(back)
    expect(at, "drawn where the leaver was").toBeGreaterThan(30)
    let furthest = at
    for (let i = 0; i < 12; i++) {
      await raf()
      furthest = Math.max(furthest, xOf(back))
    }
    expect(furthest, "kept going right before turning back").toBeGreaterThan(at + 2)
    await until(() => Math.abs(xOf(back)) < 1, 4000)
    expect(Math.abs(xOf(back))).toBeLessThan(1)
  })

  const card: WardicVariants = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
  const icon: WardicVariants = { hidden: { x: -40, transition: EXIT }, shown: { x: 0, transition: EXIT } }

  it("PK3: a Variant child inside starts where the one it pairs with in the leaver was drawn", async () => {
    const withIcon = (id: string): JSX.Element => (
      <wardic.li key={id} data-item={id} variants={card} initial="hidden" animate="shown" exit="hidden" transition={EXIT} style={{ display: "block" }}>
        <wardic.span data-icon={id} variants={icon} style={{ display: "inline-block" }}>
          *
        </wardic.span>
      </wardic.li>
    )
    const list = mountList(["a"], withIcon)
    const q = (id: string): HTMLElement => list.container.querySelector<HTMLElement>(`[data-icon="${id}"]`)!
    await until(() => opacityOf(list.node("a")) >= 0.99 && Math.abs(xOf(q("a"))) < 0.5, 2000)
    const oldIcon = q("a")
    list.setItems([])
    await until(() => xOf(oldIcon) < -12 && xOf(oldIcon) > -28, 2000)
    const at = xOf(oldIcon)
    list.setItems(["a"])
    await endOfTask()
    const newIcon = q("a")
    expect(newIcon).not.toBe(oldIcon)
    expect(xOf(newIcon), "where its pair was, not at hidden's -40").toBeCloseTo(at, 0)
    await until(() => Math.abs(xOf(newIcon)) < 0.5, 2000)
    expect(Math.abs(xOf(newIcon))).toBeLessThan(0.5)
  })

  it("PK4: inside, a different shape: only the child takes over, its inner elements enter as their own", async () => {
    const [badge, setBadge] = createSignal(false)
    const withIcon = (id: string): JSX.Element => (
      <wardic.li key={id} data-item={id} variants={card} initial="hidden" animate="shown" exit="hidden" transition={EXIT} style={{ display: "block" }}>
        <wardic.span data-icon={id} variants={icon} style={{ display: "inline-block" }}>
          *
        </wardic.span>
        <Show when={badge()}>
          <wardic.b variants={icon} style={{ display: "inline-block" }}>
            !
          </wardic.b>
        </Show>
      </wardic.li>
    )
    const list = mountList(["a"], withIcon)
    const q = (id: string): HTMLElement => list.container.querySelector<HTMLElement>(`[data-icon="${id}"]`)!
    await until(() => opacityOf(list.node("a")) >= 0.99 && Math.abs(xOf(q("a"))) < 0.5, 2000)
    const old = list.node("a")
    list.setItems([])
    await midExit(old)
    const at = opacityOf(old)
    setBadge(true)
    list.setItems(["a"])
    await endOfTask()
    expect(opacityOf(list.node("a")), "the child itself takes over").toBeCloseTo(at, 1)
    expect(xOf(q("a")), "its icon enters from hidden").toBeLessThan(-35)
  })

  it("PK5: no onExitComplete for a take-over", async () => {
    const list = mountList(["a", "b"], fading)
    await until(() => opacityOf(list.node("b")) >= 0.99, 2000)
    const b = list.node("b")
    list.setItems(["a"])
    await midExit(b)
    list.setItems(["a", "b"])
    await frames(40)
    expect(list.completes()).toBe(0)
  })

  it("PK6: mode=wait doesn't hold a child back under its key; the one held for it never shows", async () => {
    const [tab, setTab] = createSignal("home")
    const { container } = render(() => (
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
    const tabs = (t: string): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>(`[data-tab="${t}"]`))
    await until(() => opacityOf(tabs("home")[0]!) >= 0.99, 2000)
    const home = tabs("home")[0]!
    setTab("settings")
    expect(tabs("settings").length, "held off the page").toBe(0)
    await midExit(home)
    const at = opacityOf(home)
    setTab("home")
    await endOfTask()
    expect(home.isConnected, "the leaver went").toBe(false)
    expect(tabs("home").length, "back at once, not held").toBe(1)
    expect(opacityOf(tabs("home")[0]!)).toBeCloseTo(at, 1)
    await frames(30)
    expect(tabs("settings").length, "never shown").toBe(0)
  })

  it("PK7: mode=popLayout: the new node is in the flow, the popped leaver gone", async () => {
    const list = mountList(["a", "b", "c"], fading, { mode: "popLayout" })
    await until(() => opacityOf(list.node("c")) >= 0.99, 2000)
    const b = list.node("b")
    list.setItems(["a", "c"])
    await frames(2)
    expect(b.style.position, "popped").toBe("absolute")
    await midExit(b)
    list.setItems(["a", "b", "c"])
    expect(b.isConnected).toBe(false)
    const back = list.node("b")
    expect(back.style.position, "in the flow").not.toBe("absolute")
    expect(list.order()).toEqual(["a", "b", "c"])
  })

  it("PK8: a list rebuilt in one change, same keys: nothing exits, each new node where its old one was", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<{ readonly id: string }>>([{ id: "a" }, { id: "b" }])
    let completes = 0
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <ul>
          <AnimatePresence onExitComplete={() => completes++}>
            <For each={items()}>
              {(it) => (
                <wardic.li key={it.id} data-item={it.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                  {it.id}
                </wardic.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    const nodes = (): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>("[data-item]"))
    await until(() => nodes().every((n) => opacityOf(n) >= 0.99), 2000)
    const before = nodes()
    setItems(items().map((it) => ({ ...it })))
    await endOfTask()
    const after = nodes()
    expect(after.length, "no leaver kept").toBe(2)
    expect(after[0]).not.toBe(before[0])
    expect(after.every((n) => opacityOf(n) >= 0.99), "drawn where the old ones were").toBe(true)
    await frames(30)
    expect(nodes().every((n) => opacityOf(n) >= 0.99), "nothing faded").toBe(true)
    expect(completes).toBe(0)
  })

  it("PK9: a usePresence holding the leaver doesn't keep it: it goes at the take-over", async () => {
    const leaves = vi.fn()
    const held = (id: string): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(
        () => el,
        () => leaves(),
      )
      return (
        <wardic.li ref={el} key={id} data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
          {id}
        </wardic.li>
      )
    }
    const list = mountList(["a"], held)
    await until(() => opacityOf(list.node("a")) >= 0.99, 2000)
    const a = list.node("a")
    list.setItems([])
    await midExit(a)
    expect(leaves).toHaveBeenCalledTimes(1)
    list.setItems(["a"])
    expect(a.isConnected, "gone, though never released").toBe(false)
    expect(list.all("a").length).toBe(1)
  })

  it("PK10: two leavers with one key: the latest is taken over, the other keeps exiting", async () => {
    const shared = (id: string): JSX.Element => (
      <wardic.li key="k" data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
        {id}
      </wardic.li>
    )
    const list = mountList(["a", "b"], shared)
    await until(() => opacityOf(list.node("b")) >= 0.99, 2000)
    const a = list.node("a")
    const b = list.node("b")
    list.setItems(["b"])
    await frames(3)
    list.setItems([])
    await frames(2)
    list.setItems(["c"])
    expect(b.isConnected, "the latest leaver taken over").toBe(false)
    expect(a.isConnected, "the other keeps exiting").toBe(true)
    await until(() => !a.isConnected, 2000)
    expect(a.isConnected).toBe(false)
  })

  it("PK11: a key inside the child, not on it, does nothing: both show", async () => {
    const inner = (id: string): JSX.Element => (
      <wardic.li data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
        <wardic.span key={id}>{id}</wardic.span>
      </wardic.li>
    )
    const list = mountList(["a"], inner)
    await until(() => opacityOf(list.node("a")) >= 0.99, 2000)
    const a = list.node("a")
    list.setItems([])
    await midExit(a)
    list.setItems(["a"])
    expect(a.isConnected, "the leaver finishes its exit").toBe(true)
    expect(list.all("a").length).toBe(2)
  })

  it("PK12: key never reaches the DOM", async () => {
    const list = mountList(["a"], fading)
    await frames(2)
    expect(list.node("a").hasAttribute("key")).toBe(false)
  })

  it("PK13: back after its leaver went: it enters from its initial", async () => {
    const list = mountList(["a"], fading)
    await until(() => opacityOf(list.node("a")) >= 0.99, 2000)
    const a = list.node("a")
    list.setItems([])
    await until(() => !a.isConnected, 2000)
    list.setItems(["a"])
    await endOfTask()
    expect(opacityOf(list.node("a")), "its initial").toBeLessThan(0.05)
  })

  it("PK14: a key the leaver drew and no layer sets now returns to its Base value from there", async () => {
    const sliding = (id: string): JSX.Element => (
      <wardic.li key={id} data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 100 }} transition={EXIT} style={{ display: "block", width: "40px" }}>
        {id}
      </wardic.li>
    )
    const list = mountList(["a"], sliding)
    await until(() => opacityOf(list.node("a")) >= 0.99, 2000)
    const a = list.node("a")
    list.setItems([])
    await until(() => xOf(a) > 30 && xOf(a) < 70, 2000)
    const at = xOf(a)
    list.setItems(["a"])
    await endOfTask()
    const back = list.node("a")
    expect(xOf(back), "from the leaver's x").toBeCloseTo(at, 0)
    await until(() => Math.abs(xOf(back)) < 0.5, 2000)
    expect(Math.abs(xOf(back)), "back at its Base value").toBeLessThan(0.5)
  })

  it("PK15: onAnimationStart once for the new node, with its animate", async () => {
    const starts: Array<unknown> = []
    const told = (id: string): JSX.Element => (
      <wardic.li
        key={id}
        data-item={id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={EXIT}
        onAnimationStart={(definition) => starts.push(definition)}
      >
        {id}
      </wardic.li>
    )
    const list = mountList(["a"], told)
    await until(() => opacityOf(list.node("a")) >= 0.99, 2000)
    const a = list.node("a")
    list.setItems([])
    await midExit(a)
    starts.length = 0
    list.setItems(["a"])
    await frames(3)
    expect(starts).toEqual([{ opacity: 1 }])
  })

  it("PK16: a tween's velocity, measured from its frames, carries over into a spring", async () => {
    const SPRING = { type: "spring", stiffness: 60, damping: 12 } as const
    const sliding = (id: string): JSX.Element => (
      <wardic.li
        key={id}
        data-item={id}
        initial={{ x: 0 }}
        animate={{ x: 0 }}
        exit={{ x: 400, transition: { type: "tween", duration: 0.5 } }}
        transition={SPRING}
        style={{ display: "block", width: "40px" }}
      >
        {id}
      </wardic.li>
    )
    const list = mountList(["a"], sliding)
    await frames(3)
    const a = list.node("a")
    list.setItems([])
    await until(() => xOf(a) > 80, 2000)
    list.setItems(["a"])
    await endOfTask()
    const back = list.node("a")
    const at = xOf(back)
    let furthest = at
    for (let i = 0; i < 12; i++) {
      await raf()
      furthest = Math.max(furthest, xOf(back))
    }
    expect(furthest, "kept going right at the tween's 800 px/s before turning back").toBeGreaterThan(at + 5)
  })

  it("PK17: use:wardic's key takes over too", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a"])
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <ul>
          <AnimatePresence>
            <For each={items()}>
              {(id) => (
                <li data-item={id} use:wardic={{ key: id, initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: EXIT }}>
                  {id}
                </li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    const all = (): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>('[data-item="a"]'))
    await until(() => opacityOf(all()[0]!) >= 0.99, 2000)
    const a = all()[0]!
    setItems([])
    await midExit(a)
    const at = opacityOf(a)
    setItems(["a"])
    await endOfTask()
    expect(a.isConnected, "the leaver went at once").toBe(false)
    expect(all().length).toBe(1)
    expect(opacityOf(all()[0]!)).toBeCloseTo(at, 1)
  })
})
