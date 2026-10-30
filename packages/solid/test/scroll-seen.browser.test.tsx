// Where things were seen, kept through the page's scroll at a change (#480, ADR-0010 and ADR-0048,
// *Amendment (#480)*): a router scrolls to the top a task after a navigation, before its first frame.
// A flight from a twin gone or leaving starts where that twin was seen, and a leaver `popLayout`
// popped stays where it was seen, once; scrolling after moves them with the page, as ever. Motion
// (framer-motion 13.4, React 19) flies the twin in from where it is in the page, off-screen. Solid 2's
// are SSV1–.
//
// - SS1: a swap with no presence (a Switch): the new twin's first frame where the old was seen.
// - SS2: `popLayout`: the new twin from where its leaving twin was seen, and the popped leaver kept
//   there through the scroll, then gone.
// - SS3: a scroll after the first frame moves the flight with the page.
// - SS4: a twin that stays on the page (live) moves with the scroll: the flight starts where it is now.
// - SS5: `sync`: the leaving page, in the flow, jumps with the scroll; its twin still flies from where
//   it was seen.
// - SS6: a popped page with no twin in it stays where it was seen too.
// - SS7: pinned by its bottom right (#442, `anchorX`, `anchorY`), in a container that keeps its size, a
//   popped page stays where it was seen as well: its pins move against the page's scroll.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, raf } from "./browser-helpers.ts"

afterEach(() => {
  cleanup()
  window.scrollTo(0, 0)
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const topOf = (el: Element): number => el.getBoundingClientRect().top
const leftOf = (el: Element): number => el.getBoundingClientRect().left
/** A task later, as Solid Router scrolls after a navigation: before the next frame. */
const scrollToTopLater = (): void => {
  setTimeout(() => window.scrollTo(0, 0), 0)
}
/** Scrolled as far down as the page goes; the scroll it took. */
const scrollDown = async (): Promise<number> => {
  window.scrollTo(0, document.documentElement.scrollHeight)
  await frames(3)
  return window.scrollY
}

// A slow, linear flight: one frame of it moves the twin some 10 px.
const FLIGHT: WardicTransition = { layout: { type: "tween", duration: 0.8, ease: "linear" } }
const CARD: JSX.CSSProperties = { position: "relative", top: "1500px", left: "40px", width: "80px", height: "60px", background: "teal" }
const HERO: JSX.CSSProperties = { width: "280px", height: "160px", background: "teal" }
const TALL: JSX.CSSProperties = { display: "block", width: "300px", height: "1900px" }
const SHORT: JSX.CSSProperties = { display: "block", width: "300px", height: "300px" }
const PAGE_EXIT = { exit: { opacity: 0 }, transition: { type: "tween", duration: 0.8, ease: "linear" } } as const

const PRESENCE_MODE = { popLayout: "popLayout", sync: "sync", none: "sync" } as const

/** A tall list with a card 1,500 px down, swapped for a short page with its hero, under `mode` (or no presence). */
const mountSwap = (mode: "popLayout" | "sync" | "none") => {
  const [page, setPage] = createSignal<"list" | "item">("list")
  const list = () => (
    <wardic.main data-page="list" {...PAGE_EXIT} style={TALL}>
      <wardic.div data-k="card" layoutId="card" transition={FLIGHT} style={CARD} />
    </wardic.main>
  )
  const item = () => (
    <wardic.main data-page="item" {...PAGE_EXIT} style={SHORT}>
      <wardic.div data-k="hero" layoutId="card" transition={FLIGHT} style={HERO} />
    </wardic.main>
  )
  const swap = () => <Show when={page() === "list"} fallback={item()}>{list()}</Show>
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative" }}>
        {Bool.match(mode === "none", {
          onTrue: swap,
          onFalse: () => <AnimatePresence mode={PRESENCE_MODE[mode]}>{swap()}</AnimatePresence>,
        })}
      </div>
    </WardicProvider>
  ))
  const q = (k: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-k="${k}"]`)
  return { to: setPage, q, list: () => container.querySelector<HTMLElement>("[data-page=list]") }
}

/** The new twin's top and left at its first frame after a navigation, the page scrolled to the top a task later. */
const navigate = async (m: ReturnType<typeof mountSwap>) => {
  const seen = { top: topOf(m.q("card")!), left: leftOf(m.q("card")!), list: topOf(m.list()!) }
  m.to("item")
  scrollToTopLater()
  // Read after the first frame is painted: inside its rAF the engine may not have stepped yet.
  await afterPaint()
  const hero = m.q("hero")!
  return { seen, first: { top: topOf(hero), left: leftOf(hero), scroll: window.scrollY }, hero }
}

describe("where things were seen, through the page's scroll at a change (#480)", () => {
  it("SS1: a swap with no presence: the new twin's first frame where the old was seen", async () => {
    const m = mountSwap("none")
    await frames(5)
    const scrolled = await scrollDown()
    expect(scrolled, "the page scrolled down").toBeGreaterThan(500)
    const { seen, first, hero } = await navigate(m)
    expect(first.scroll, "the page at its top").toBe(0)
    expect(Math.abs(first.top - seen.top), "from where the card was seen, px").toBeLessThan(25)
    await frames(60)
    expect(topOf(hero), "landed on its own box").toBeCloseTo(0, 0)
  })

  it("SS2: popLayout: from where the leaving twin was seen; the popped leaver kept there, then gone", async () => {
    const m = mountSwap("popLayout")
    await frames(5)
    await scrollDown()
    const list = m.list()!
    const { seen, first, hero } = await navigate(m)
    expect(first.scroll, "the page at its top").toBe(0)
    expect(Math.abs(first.top - seen.top), "from where the card was seen, px").toBeLessThan(25)
    expect(list.isConnected, "the list still leaving").toBe(true)
    expect(topOf(list), "the popped list where it was seen, not at its own top").toBeCloseTo(seen.list, 0)
    // Its card, moved with it, still rides the hero: its kept box went with it.
    await frames(5)
    expect(Math.abs(topOf(m.q("card")!) - topOf(hero)), "the card on the hero, px").toBeLessThan(0.75)
    await frames(65)
    expect(list.isConnected, "gone after").toBe(false)
    expect(topOf(hero), "the hero on its own box").toBeCloseTo(0, 0)
  })

  it("SS3: a scroll after the first frame moves the flight with the page", async () => {
    const m = mountSwap("none")
    await frames(5)
    await scrollDown()
    const { hero } = await navigate(m)
    await frames(4)
    // The page grown again by the short item and some room below, to scroll within the flight.
    document.body.style.paddingBottom = "3000px"
    try {
      const before = topOf(hero)
      window.scrollTo(0, 200)
      await raf()
      // One frame's flight is some 10 px; the scroll moves it by 200 on top.
      expect(before - topOf(hero), "moved up with the page, px").toBeGreaterThan(170)
    } finally {
      document.body.style.paddingBottom = ""
    }
  })

  it("SS4: a twin that stays on the page moves with the scroll: the flight starts where it is now", async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "2000px" }}>
          <wardic.div data-k="thumb" layoutId="t" transition={FLIGHT} style={{ position: "absolute", top: "1500px", left: "40px", width: "80px", height: "60px", background: "teal" }} />
          <Show when={open()}>
            <wardic.div data-k="big" layoutId="t" transition={FLIGHT} style={{ position: "absolute", top: "0px", left: "40px", width: "280px", height: "160px", background: "teal" }} />
          </Show>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    await scrollDown()
    const thumb = container.querySelector("[data-k=thumb]")!
    setOpen(true)
    scrollToTopLater()
    await afterPaint()
    const big = container.querySelector("[data-k=big]")!
    expect(window.scrollY, "the page at its top").toBe(0)
    // The thumbnail stays, its own box moved by the scroll to 1,500 px down its frame: the flight starts
    // from it there. (Drawn, it's now a Follower on the new twin, so its own box is read from the layout.)
    const home = (thumb as HTMLElement).offsetTop + container.querySelector("div")!.getBoundingClientRect().top
    expect(home, "the thumbnail's box at 1,500 px").toBeCloseTo(1500, 0)
    // A frame into a 1,500 px flight, some 30 px.
    expect(Math.abs(topOf(big) - home), "from where the live twin is now, px").toBeLessThan(45)
  })

  it("SS5: sync: the leaving page jumps with the scroll; its twin flies from where it was seen", async () => {
    const m = mountSwap("sync")
    await frames(5)
    await scrollDown()
    const list = m.list()!
    const { seen, first } = await navigate(m)
    // A frame into a longer flight: the hero sits below the leaving list in the flow, some 1,400 px.
    expect(Math.abs(first.top - seen.top), "from where the card was seen, px").toBeLessThan(45)
    expect(topOf(list), "the list, in the flow, at its own top").toBeCloseTo(0, 0)
  })

  it("SS6: a popped page with no twin in it stays where it was seen too", async () => {
    const [page, setPage] = createSignal<"list" | "item">("list")
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative" }}>
          <AnimatePresence mode="popLayout">
            <Show when={page() === "list"} fallback={<wardic.main data-page="item" {...PAGE_EXIT} style={SHORT} />}>
              <wardic.main data-page="list" {...PAGE_EXIT} style={TALL} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    await scrollDown()
    const list = container.querySelector<HTMLElement>("[data-page=list]")!
    const seen = topOf(list)
    setPage("item")
    scrollToTopLater()
    await afterPaint()
    expect(window.scrollY, "the page at its top").toBe(0)
    expect(topOf(list), "the popped list where it was seen").toBeCloseTo(seen, 0)
  })

  it("SS7: pinned by its bottom right, in a container that keeps its size, a popped page stays where it was seen", async () => {
    const [page, setPage] = createSignal<"list" | "item">("list")
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "500px", height: "1900px" }}>
          <AnimatePresence mode="popLayout" anchorX="right" anchorY="bottom">
            <Show when={page() === "list"} fallback={<wardic.main data-page="item" {...PAGE_EXIT} style={SHORT} />}>
              <wardic.main data-page="list" {...PAGE_EXIT} style={TALL} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    await scrollDown()
    const list = container.querySelector<HTMLElement>("[data-page=list]")!
    const seen = { top: topOf(list), left: leftOf(list) }
    setPage("item")
    scrollToTopLater()
    await afterPaint()
    expect(window.scrollY, "the page at its top").toBe(0)
    expect([list.style.getPropertyValue("bottom"), list.style.getPropertyValue("right")], "pinned by its bottom right").not.toContain("")
    expect(topOf(list), "the popped list where it was seen").toBeCloseTo(seen.top, 0)
    expect(leftOf(list)).toBeCloseTo(seen.left, 0)
  })
})
