// Page transitions with Solid Router on Solid 2 (#479): Solid 1's RT1–RT6, through
// `@solidjs/router` 2.0.0-next.42 (`createRouter`, its memory history, which scrolls to the top
// after a navigation as the browser's does).
//
// - RTV1: a navigation to another route swaps the page's root node: the old page leaves, popped out
//   of the flow, while the new one enters, with no `key`; a change of the route's params alone keeps
//   the node.
// - RTV2: under `popLayout`, a `layoutId` card on the leaving page flies into the new page's hero.
// - RTV3: a params change, its content keyed (`<Show keyed>` in a presence of its own): the old
//   content leaves, the new enters, the page's node kept.
// - RTV4: a route loading its data (an async memo under `Loading`): the old page stays, not leaving,
//   until the data resolves, then leaves as the new page enters.
// - RTV5: a page with a `Loading` of its own around its data (a skeleton), its `layoutId` hero outside
//   it: the page is in at once with its skeleton, the old one leaving, and the hero flies from the
//   card while the data loads; the data then takes the skeleton's place.
// - RTV6 (#482): the leaving page's card rides the hero's flight, then goes with its page.
// - RTV7 (#486): a point over the new page mid-transition hits it, not the popped list.
// - RTV8 (#480): from a list scrolled down, the router's scroll to the top: the hero from where the
//   card was seen, and the popped list where it was seen.
// - RTV9 (#682): rapid back and forth (piece A, the list, piece B, 150 ms apart): A's photo on the
//   list that leaves, mid-flight back from A's leaving hero, stays where it's drawn as it fades.
import type { JSX } from "@solidjs/web"
import { createRouter, memoryHistory, useNavigate, useParams } from "@solidjs/router-2"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createMemo, Loading, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, paintedReads, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

afterEach(() => window.scrollTo(0, 0))

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const SLOW: WardicTransition = { type: "tween", duration: 0.6, ease: "linear" }
const PAGE = { display: "block", width: "300px", "min-height": "200px" } as const

/** `routes` under a router on a memory history, its outlet in a presence of `mode` (and `Loading` with `loading`). */
const mountRoutes = (routes: ReadonlyArray<{ readonly path: string; readonly component: (props: { readonly children?: JSX.Element }) => JSX.Element }>, mode: "wait" | "popLayout", loading = false) => {
  let navigate!: (to: string) => void
  const Router = createRouter({ routes: routes as never, history: memoryHistory("/") })
  const Outlet = (props: { readonly children?: JSX.Element }) => {
    const go = useNavigate()
    navigate = (to) => go(to)
    const presence = () => <AnimatePresence mode={mode}>{props.children}</AnimatePresence>
    // `loading` is fixed for the mount: one tree or the other, chosen once.
    return Bool.match(loading, { onTrue: () => <Loading>{presence()}</Loading>, onFalse: presence })
  }
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Router>{(props) => <Outlet>{props.children}</Outlet>}</Router>
    </WardicProvider>
  ))
  return {
    navigate: (to: string) => navigate(to),
    pages: () => Array.from(host.querySelectorAll<HTMLElement>("[data-page]")),
    el: (k: string) => host.querySelector<HTMLElement>(`[data-k="${k}"]`),
    host,
  }
}

const List = () => (
  <wardic.main data-page="list" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
    <wardic.div data-k="card" layoutId="card-3" transition={SLOW} style={{ position: "relative", top: "40px", left: "40px", width: "80px", height: "60px", background: "teal" }} />
  </wardic.main>
)

const Item = () => {
  const params = useParams()
  return (
    <wardic.main data-page="item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
      <wardic.div data-k="hero" layoutId="card-3" transition={SLOW} style={{ width: "280px", height: "160px", background: "teal" }} />
      <span data-k="id">{params.id}</span>
    </wardic.main>
  )
}

// The catalogue (#682): two photos on the list, each a piece's hero, Motion's default layout tween.
const FLIGHT: WardicTransition = { type: "tween", duration: 0.45, ease: [0.4, 0, 0.1, 1] }
const FADE: WardicTransition = { type: "tween", duration: 0.25 }
const SHEET = { display: "block", width: "600px", "min-height": "300px" } as const
const photoAt = (left: number) => ({ position: "absolute", top: "200px", left: `${left}px`, width: "160px", height: "120px", background: "teal" }) as const

const Catalogue = () => (
  <wardic.main data-page="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} style={SHEET}>
    <wardic.div data-k="card-a" layoutId="photo-a" transition={{ layout: FLIGHT }} style={photoAt(20)} />
    <wardic.div data-k="card-b" layoutId="photo-b" transition={{ layout: FLIGHT }} style={photoAt(220)} />
  </wardic.main>
)

const Piece = () => {
  const params = useParams()
  return (
    <wardic.main data-page="piece" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} style={SHEET}>
      <wardic.div data-k="hero" layoutId={`photo-${params.id}`} transition={{ layout: FLIGHT }} style={{ width: "320px", height: "240px", background: "teal" }} />
    </wardic.main>
  )
}

/** The opacity `el` is drawn at: its own and every ancestor's. */
const drawnOpacityOf = (el: Element): number => {
  let opacity = 1
  for (let at: Element | null = el; at !== null; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity)
  return opacity
}

describe("page transitions with Solid Router on Solid 2 (#479)", () => {
  it("RTV1: a route change swaps the page's node: the old leaves, popped, while the new enters; params alone keep it", async () => {
    const app = mountRoutes([{ path: "/", component: List }, { path: "/item/:id", component: Item }], "popLayout")
    await until(() => app.pages().length === 1, 2000)
    const list = app.pages()[0]!
    app.navigate("/item/3")
    await until(() => app.pages().some((p) => p.dataset.page === "item"), 2000)
    await frames(3)
    expect(app.pages().map((p) => p.dataset.page).sort(), "the list leaving beside the item").toEqual(["item", "list"])
    expect(getComputedStyle(list).position, "popped out of the flow").toBe("absolute")
    expect(Number(getComputedStyle(list).opacity), "on its way out").toBeLessThan(1)
    await until(() => !list.isConnected, 2000)
    expect(list.isConnected, "gone once its exit lands").toBe(false)
    const item = app.pages()[0]!
    app.navigate("/item/4")
    await until(() => app.el("id")?.textContent === "4", 2000)
    expect(app.pages(), "the same node, its params changed").toEqual([item])
  })

  it("RTV2: under popLayout, a layoutId card flies into the new page's hero", async () => {
    const app = mountRoutes([{ path: "/", component: List }, { path: "/item/:id", component: Item }], "popLayout")
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    const card = app.el("card")!.getBoundingClientRect()
    app.navigate("/item/3")
    await until(() => app.el("hero") !== null, 2000)
    await frames(2)
    const hero = app.el("hero")!
    const early = hero.getBoundingClientRect()
    expect(Math.abs(early.left - card.left), "it starts at the card's box").toBeLessThan(30)
    expect(early.width, "the card's size, not the hero's 280").toBeLessThan(160)
    await until(() => Math.abs(hero.getBoundingClientRect().width - 280) < 0.5, 2000)
    expect(hero.getBoundingClientRect().width, "landed on its own box").toBeCloseTo(280, 0)
  })

  it("RTV3: a params change, its content keyed: the old content leaves, the new enters, the page kept", async () => {
    const Keyed = () => {
      const params = useParams()
      return (
        <wardic.main data-page="item" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={PAGE}>
          <AnimatePresence mode="popLayout">
            <Show keyed when={params.id}>
              {(id) => (
                <wardic.section data-item={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW}>
                  item {id}
                </wardic.section>
              )}
            </Show>
          </AnimatePresence>
        </wardic.main>
      )
    }
    const app = mountRoutes([{ path: "/", component: List }, { path: "/item/:id", component: Keyed }], "popLayout")
    app.navigate("/item/3")
    await until(() => app.host.querySelector("[data-item='3']") !== null, 2000)
    await until(() => app.pages().length === 1, 2000)
    await frames(3)
    const page = app.pages()[0]!
    app.navigate("/item/4")
    await until(() => app.host.querySelector("[data-item='4']") !== null, 2000)
    await frames(3)
    const three = app.host.querySelector<HTMLElement>("[data-item='3']")
    expect(three, "item 3 leaving beside item 4").not.toBeNull()
    expect(Number(getComputedStyle(three!).opacity), "on its way out").toBeLessThan(1)
    expect(app.pages()[0], "the page's node kept").toBe(page)
    await until(() => app.host.querySelector("[data-item='3']") === null, 2000)
    expect(app.host.querySelector("[data-item='3']"), "gone once its exit lands").toBeNull()
  })

  it("RTV4: a route loading its data: the old page stays, not leaving, until it resolves, then leaves", async () => {
    let resolve!: (value: string) => void
    const Slow = () => {
      const data = createMemo(() => new Promise<string>((done) => (resolve = done)))
      return (
        <wardic.main data-page="slow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
          {data()}
        </wardic.main>
      )
    }
    const List = () => (
      <wardic.main data-page="list" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
        list
      </wardic.main>
    )
    const app = mountRoutes([{ path: "/", component: List }, { path: "/slow", component: Slow }], "popLayout", true)
    await until(() => app.pages().length === 1, 2000)
    await frames(3)
    const list = app.pages()[0]!
    app.navigate("/slow")
    await frames(10)
    expect(list.isConnected, "the list stays while the data loads").toBe(true)
    expect(Number(getComputedStyle(list).opacity), "and isn't leaving").toBeCloseTo(1, 3)
    resolve("loaded")
    await until(() => app.pages().some((p) => p.dataset.page === "slow"), 2000)
    await frames(3)
    expect(Number(getComputedStyle(list).opacity), "now it leaves").toBeLessThan(1)
    await until(() => !list.isConnected, 2000)
    expect(app.pages()[0]!.textContent).toContain("loaded")
  })

  it("RTV5: a skeleton in the page, the hero outside it: the page in at once, the hero flying while the data loads", async () => {
    let resolve!: (value: string) => void
    const Skeleton = () => {
      const data = createMemo(() => new Promise<string>((done) => (resolve = done)))
      return (
        <wardic.main data-page="item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
          <wardic.div data-k="hero" layoutId="card-3" transition={SLOW} style={{ width: "280px", height: "160px", background: "teal" }} />
          <Loading fallback={<p data-k="skeleton">…</p>}>
            <p data-k="data">{data()}</p>
          </Loading>
        </wardic.main>
      )
    }
    const app = mountRoutes([{ path: "/", component: List }, { path: "/item", component: Skeleton }], "popLayout", true)
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    const list = app.pages()[0]!
    const card = app.el("card")!.getBoundingClientRect()
    app.navigate("/item")
    await until(() => app.el("hero") !== null, 2000)
    await frames(2)
    expect(app.el("skeleton"), "the page in with its skeleton, not held").not.toBeNull()
    expect(Number(getComputedStyle(list).opacity), "the list leaving meanwhile").toBeLessThan(1)
    const hero = app.el("hero")!
    const early = hero.getBoundingClientRect()
    expect(Math.abs(early.left - card.left), "the hero starts at the card's box").toBeLessThan(30)
    expect(early.width, "the card's size, not the hero's 280").toBeLessThan(160)
    resolve("loaded")
    await until(() => app.el("data") !== null, 2000)
    expect(app.el("skeleton"), "the data in the skeleton's place").toBeNull()
    expect(app.el("data")!.textContent).toBe("loaded")
    await until(() => Math.abs(hero.getBoundingClientRect().width - 280) < 0.5, 2000)
    expect(app.el("hero"), "the same hero, landed on its own box").toBe(hero)
  })

  it("RTV6: the leaving page's card rides the hero's flight, then goes with its page (#482)", async () => {
    const app = mountRoutes([{ path: "/", component: List }, { path: "/item/:id", component: Item }], "popLayout")
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    const card = app.el("card")!
    const list = app.pages()[0]!
    app.navigate("/item/3")
    await until(() => app.el("hero") !== null, 2000)
    const hero = app.el("hero")!
    let shown = 0
    let worst = 0
    for (let i = 0; i < 60 && card.isConnected; i++) {
      await raf()
      if (Bool.not(card.isConnected)) break
      if (Number(getComputedStyle(card).opacity) < 0.01) continue
      shown++
      const a = card.getBoundingClientRect()
      const b = hero.getBoundingClientRect()
      worst = Math.max(worst, Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
    }
    expect(shown, "frames the card shows").toBeGreaterThan(5)
    expect(worst, "the card off the hero, px").toBeLessThan(0.75)
    await until(() => Bool.not(list.isConnected), 2000)
    expect(list.isConnected, "the list gone with its card").toBe(false)
  })

  it("RTV7: a point over the new page mid-transition hits it, not the popped list over it (#486)", async () => {
    const app = mountRoutes([{ path: "/", component: List }, { path: "/item/:id", component: Item }], "popLayout")
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    const list = app.pages()[0]!
    app.navigate("/item/3")
    await until(() => app.pages().some((p) => p.dataset.page === "item"), 2000)
    await frames(3)
    const item = app.pages().find((p) => p.dataset.page === "item")!
    expect(list.isConnected, "the list still leaving").toBe(true)
    expect(app.pages().map((p) => p.dataset.page), "the leaving list before the new page").toEqual(["list", "item"])
    const r = item.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + 150, r.top + 100)?.closest<HTMLElement>("[data-page]")
    expect(hit?.dataset.page, "the point hits the new page").toBe("item")
  })

  it("RTV8: from a list scrolled down, the router's scroll to the top: from where the card was seen (#480)", async () => {
    const TallList = () => (
      <wardic.main data-page="list" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={{ ...PAGE, "min-height": "1900px" }}>
        <wardic.div data-k="card" layoutId="card-3" transition={SLOW} style={{ position: "relative", top: "1500px", left: "40px", width: "80px", height: "60px", background: "teal" }} />
      </wardic.main>
    )
    const app = mountRoutes([{ path: "/", component: TallList }, { path: "/item/:id", component: Item }], "popLayout")
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    window.scrollTo(0, document.documentElement.scrollHeight)
    await frames(3)
    expect(window.scrollY, "the list scrolled down").toBeGreaterThan(500)
    const list = app.pages()[0]!
    const seen = { card: app.el("card")!.getBoundingClientRect().top, list: list.getBoundingClientRect().top }
    app.navigate("/item/3")
    await until(() => app.el("hero") !== null, 2000)
    await afterPaint()
    expect(window.scrollY, "the router scrolled to the top").toBe(0)
    expect(Math.abs(app.el("hero")!.getBoundingClientRect().top - seen.card), "the hero from where the card was seen, px").toBeLessThan(40)
    expect(list.getBoundingClientRect().top, "the popped list where it was seen").toBeCloseTo(seen.list, 0)
  })
  it("RTV9: rapid back and forth: the photo on the list that leaves stays where it's drawn, though its twins are leaving too (#682)", async () => {
    const app = mountRoutes([{ path: "/", component: Catalogue }, { path: "/item/:id", component: Piece }], "popLayout")
    await until(() => app.host.querySelectorAll('[data-k="card-a"]').length === 1, 2000)
    await frames(20)
    app.navigate("/item/a")
    await new Promise((resolve) => setTimeout(resolve, 150))
    app.navigate("/")
    await new Promise((resolve) => setTimeout(resolve, 150))
    const photo = Array.from(app.host.querySelectorAll<HTMLElement>('[data-k="card-a"]')).at(-1)!
    const seen = paintedReads(() => ({ box: photo.getBoundingClientRect(), opacity: drawnOpacityOf(photo) }), 14)
    app.navigate("/item/b")
    const shown = (await seen).filter((f) => f.opacity > 0.02)
    expect(shown.length, "it shows while its page fades").toBeGreaterThan(3)
    const first = shown[0]!.box
    for (const [i, f] of shown.entries()) {
      expect(Math.abs(f.box.left - first.left), `frame ${i}: left`).toBeLessThan(0.5)
      expect(Math.abs(f.box.top - first.top), `frame ${i}: top`).toBeLessThan(0.5)
      expect(Math.abs(f.box.width - first.width), `frame ${i}: width`).toBeLessThan(0.5)
    }
  })
})
