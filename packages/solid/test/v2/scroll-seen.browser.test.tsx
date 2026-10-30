// Where things were seen, through the page's scroll at a change, on Solid 2 (#480): Solid 1's SS1 and
// SS2, with `wardic.*`.
//
// - SSV1: a swap with no presence: the new twin's first frame where the old was seen.
// - SSV2: `popLayout`: from where the leaving twin was seen, and the popped leaver kept there through
//   the scroll, then gone.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

afterEach(() => window.scrollTo(0, 0))

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const topOf = (el: Element): number => el.getBoundingClientRect().top

const FLIGHT: WardicTransition = { layout: { type: "tween", duration: 0.8, ease: "linear" } }
const CARD: JSX.CSSProperties = { position: "relative", top: "1500px", left: "40px", width: "80px", height: "60px", background: "teal" }
const HERO: JSX.CSSProperties = { width: "280px", height: "160px", background: "teal" }
const PAGE_EXIT = { exit: { opacity: 0 }, transition: { type: "tween", duration: 0.8, ease: "linear" } } as const

const mountSwap = (presence: boolean) => {
  const [page, setPage] = createSignal<"list" | "item">("list")
  const swap = () => (
    <Show
      when={page() === "list"}
      fallback={
        <wardic.main data-page="item" {...PAGE_EXIT} style={{ display: "block", width: "300px", height: "300px" }}>
          <wardic.div data-k="hero" layoutId="card" transition={FLIGHT} style={HERO} />
        </wardic.main>
      }
    >
      <wardic.main data-page="list" {...PAGE_EXIT} style={{ display: "block", width: "300px", height: "1900px" }}>
        <wardic.div data-k="card" layoutId="card" transition={FLIGHT} style={CARD} />
      </wardic.main>
    </Show>
  )
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative" }}>{Bool.match(presence, { onTrue: () => <AnimatePresence mode="popLayout">{swap()}</AnimatePresence>, onFalse: swap })}</div>
    </WardicProvider>
  ))
  return { to: setPage, q: (k: string) => host.querySelector<HTMLElement>(`[data-k="${k}"]`), list: () => host.querySelector<HTMLElement>("[data-page=list]") }
}

const navigate = async (m: ReturnType<typeof mountSwap>) => {
  window.scrollTo(0, document.documentElement.scrollHeight)
  await frames(3)
  const seen = { top: topOf(m.q("card")!), list: topOf(m.list()!) }
  m.to("item")
  setTimeout(() => window.scrollTo(0, 0), 0)
  await afterPaint()
  return { seen, first: topOf(m.q("hero")!), scroll: window.scrollY }
}

describe("where things were seen, through the page's scroll at a change, on Solid 2 (#480)", () => {
  it("SSV1: a swap with no presence: the new twin's first frame where the old was seen", async () => {
    const m = mountSwap(false)
    await frames(5)
    const { seen, first, scroll } = await navigate(m)
    expect(scroll, "the page at its top").toBe(0)
    expect(Math.abs(first - seen.top), "from where the card was seen, px").toBeLessThan(25)
  })

  it("SSV2: popLayout: from where the leaving twin was seen; the popped leaver kept there, then gone", async () => {
    const m = mountSwap(true)
    await frames(5)
    const list = m.list()!
    const { seen, first } = await navigate(m)
    expect(Math.abs(first - seen.top), "from where the card was seen, px").toBeLessThan(25)
    expect(topOf(list), "the popped list where it was seen").toBeCloseTo(seen.list, 0)
    await frames(70)
    expect(list.isConnected, "gone after").toBe(false)
  })
})
