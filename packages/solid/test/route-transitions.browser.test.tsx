// Page transitions with Solid Router on Solid 1 (#479): an `<AnimatePresence>` around the router's
// outlet, each page's root a Wardic element. Through the real router (`@solidjs/router` 1.0.0), its
// memory history, which scrolls to the top after a navigation as the browser's does. Solid 2's are
// RTV1–.
//
// - RT1: a navigation to another route swaps the page's root node: the old page leaves, popped out
//   of the flow, while the new one enters, with no `key`; a change of the route's params alone keeps
//   the node.
// - RT2: under `popLayout`, a `layoutId` card on the leaving page flies into the new page's hero, and
//   back.
// - RT3: under `wait`, the new page mounts once the old one has gone, so no card flies: the hero is
//   drawn at its own box from its first frame.
// - RT4: a navigation back in the middle of a transition: the item leaves, the list comes back as a
//   new page, its card flying back, and nothing is left behind.
// - RT5: a change of the route's params alone, its content keyed (`<Show keyed>` in a presence of its
//   own): the old content leaves, the new enters, the page's node kept.
// - RT6: a route loading its data (`createResource` under `Suspense`): the old page stays, not
//   leaving, until the data resolves, then leaves as the new page enters.
import { createMemoryHistory, MemoryRouter, Route, useNavigate, useParams } from "@solidjs/router"
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import { createResource, type JSX, Show, Suspense } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(() => {
  cleanup()
  window.scrollTo(0, 0)
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const SLOW: WardicTransition = { type: "tween", duration: 0.6, ease: "linear" }
const PAGE = { display: "block", width: "300px", "min-height": "200px" } as const

/**
 * The app: a list at `/` with a card (`layoutId="card-3"`) `cardTop` px down, and an item at
 * `/item/:id` with that card as its hero at the top, its outlet in a presence of `mode`.
 */
const mountShared = (mode: "sync" | "wait" | "popLayout", cardTop = 40) => {
  const history = createMemoryHistory()
  let navigate!: (to: string) => void
  let back!: () => void
  const Root = (props: { readonly children?: JSX.Element }) => {
    const go = useNavigate()
    navigate = (to) => go(to)
    back = () => go(-1)
    return <AnimatePresence mode={mode}>{props.children}</AnimatePresence>
  }
  const List = () => (
    <wardic.main data-page="list" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={{ ...PAGE, "min-height": `${cardTop + 400}px` }}>
      <wardic.div data-k="card" layoutId="card-3" transition={SLOW} style={{ position: "relative", top: `${cardTop}px`, left: "40px", width: "80px", height: "60px", background: "teal" }} />
    </wardic.main>
  )
  const Item = () => (
    <wardic.main data-page="item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
      <wardic.div data-k="hero" layoutId="card-3" transition={SLOW} style={{ width: "280px", height: "160px", background: "teal" }} />
    </wardic.main>
  )
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <MemoryRouter history={history} root={Root}>
        <Route path="/" component={List} />
        <Route path="/item/:id" component={Item} />
      </MemoryRouter>
    </WardicProvider>
  ))
  return {
    navigate: (to: string) => navigate(to),
    back: () => back(),
    pages: () => Array.from(container.querySelectorAll<HTMLElement>("[data-page]")),
    el: (k: string) => container.querySelector<HTMLElement>(`[data-k="${k}"]`),
  }
}

/** The app: a list at `/` and an item at `/item/:id`, its outlet in a presence of `mode`. */
const mountApp = (mode: "sync" | "wait" | "popLayout") => {
  const history = createMemoryHistory()
  let navigate!: (to: string) => void
  const Root = (props: { readonly children?: JSX.Element }) => {
    const go = useNavigate()
    navigate = (to) => go(to)
    return <AnimatePresence mode={mode}>{props.children}</AnimatePresence>
  }
  const List = () => (
    <wardic.main data-page="list" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
      list
    </wardic.main>
  )
  const Item = () => {
    const params = useParams()
    return (
      <wardic.main data-page="item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
        item {params.id}
      </wardic.main>
    )
  }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <MemoryRouter history={history} root={Root}>
        <Route path="/" component={List} />
        <Route path="/item/:id" component={Item} />
      </MemoryRouter>
    </WardicProvider>
  ))
  return { navigate: (to: string) => navigate(to), pages: () => Array.from(container.querySelectorAll<HTMLElement>("[data-page]")) }
}

describe("page transitions with Solid Router on Solid 1 (#479)", () => {
  it("RT1: a route change swaps the page's node: the old leaves, popped, while the new enters; params alone keep it", async () => {
    const app = mountApp("popLayout")
    await until(() => app.pages().length === 1, 2000)
    const list = app.pages()[0]!
    app.navigate("/item/3")
    await until(() => app.pages().some((p) => p.dataset.page === "item"), 2000)
    await frames(3)
    const both = app.pages().map((p) => p.dataset.page).sort()
    expect(both, "the list leaving beside the item").toEqual(["item", "list"])
    expect(getComputedStyle(list).position, "popped out of the flow").toBe("absolute")
    expect(Number(getComputedStyle(list).opacity), "on its way out").toBeLessThan(1)
    await until(() => !list.isConnected, 2000)
    expect(list.isConnected, "gone once its exit lands").toBe(false)
    const item = app.pages()[0]!
    app.navigate("/item/4")
    await frames(4)
    expect(app.pages(), "the same node, its params changed").toEqual([item])
    expect(item.textContent).toContain("item 4")
  })

  it("RT2: under popLayout, a layoutId card flies into the new page's hero, and back", async () => {
    const app = mountShared("popLayout")
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
    // The old list gone first: its card, still leaving, would be the first `[data-k=card]` found.
    await until(() => app.pages().length === 1, 2000)
    app.back()
    await until(() => app.pages().some((p) => p.dataset.page === "list" && p.isConnected && getComputedStyle(p).position !== "absolute"), 2000)
    await frames(2)
    const returning = app.el("card")!.getBoundingClientRect()
    expect(returning.width, "the card flies back from the hero's size").toBeGreaterThan(100)
  })

  it("RT3: under wait, the new page mounts once the old one has gone: no card flies", async () => {
    const app = mountShared("wait")
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    const list = app.pages()[0]!
    app.navigate("/item/3")
    await frames(4)
    expect(app.el("hero"), "held while the list leaves").toBeNull()
    expect(list.isConnected).toBe(true)
    await until(() => app.el("hero") !== null, 2000)
    expect(list.isConnected, "the list has gone first").toBe(false)
    await frames(1)
    expect(app.el("hero")!.getBoundingClientRect().width, "drawn at its own box, nothing to fly from").toBeCloseTo(280, 0)
  })

  it("RT4: a navigation back mid-transition: the list comes back as a new page, nothing left behind", async () => {
    const app = mountShared("popLayout")
    await until(() => app.el("card") !== null, 2000)
    await frames(3)
    app.navigate("/item/3")
    await until(() => app.el("hero") !== null, 2000)
    await frames(6)
    app.back()
    await until(() => app.pages().filter((p) => p.dataset.page === "list").length >= 1 && app.el("hero") === null, 3000)
    await until(() => app.pages().length === 1, 3000)
    expect(app.pages().map((p) => p.dataset.page), "one page left: the list").toEqual(["list"])
    expect(app.el("card")!.isConnected).toBe(true)
    await until(() => Math.abs(app.el("card")!.getBoundingClientRect().width - 80) < 0.5, 2000)
    expect(app.el("card")!.getBoundingClientRect().width, "the card back on its own box").toBeCloseTo(80, 0)
  })

  it("RT5: a params change, its content keyed: the old content leaves, the new enters, the page kept", async () => {
    const history = createMemoryHistory()
    let navigate!: (to: string) => void
    const Root = (props: { readonly children?: JSX.Element }) => {
      const go = useNavigate()
      navigate = (to) => go(to)
      return <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
    }
    const Item = () => {
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
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <MemoryRouter history={history} root={Root}>
          <Route path="/item/:id" component={Item} />
        </MemoryRouter>
      </WardicProvider>
    ))
    navigate("/item/3")
    await until(() => container.querySelector("[data-item='3']") !== null, 2000)
    await frames(3)
    const page = container.querySelector("[data-page]")!
    navigate("/item/4")
    await until(() => container.querySelector("[data-item='4']") !== null, 2000)
    await frames(3)
    const three = container.querySelector<HTMLElement>("[data-item='3']")
    expect(three, "item 3 leaving beside item 4").not.toBeNull()
    expect(Number(getComputedStyle(three!).opacity), "on its way out").toBeLessThan(1)
    expect(container.querySelector("[data-page]"), "the page's node kept").toBe(page)
    await until(() => container.querySelector("[data-item='3']") === null, 2000)
    expect(container.querySelector("[data-item='3']"), "gone once its exit lands").toBeNull()
  })

  it("RT6: a route loading its data: the old page stays, not leaving, until it resolves, then leaves", async () => {
    const history = createMemoryHistory()
    let navigate!: (to: string) => void
    let resolve!: (value: string) => void
    const Root = (props: { readonly children?: JSX.Element }) => {
      const go = useNavigate()
      navigate = (to) => go(to)
      return (
        <Suspense>
          <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
        </Suspense>
      )
    }
    const List = () => (
      <wardic.main data-page="list" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
        list
      </wardic.main>
    )
    const Slow = () => {
      const [data] = createResource(() => new Promise<string>((done) => (resolve = done)))
      return (
        <wardic.main data-page="slow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={PAGE}>
          {data()}
        </wardic.main>
      )
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <MemoryRouter history={history} root={Root}>
          <Route path="/" component={List} />
          <Route path="/slow" component={Slow} />
        </MemoryRouter>
      </WardicProvider>
    ))
    const pages = () => Array.from(container.querySelectorAll<HTMLElement>("[data-page]"))
    await until(() => pages().length === 1, 2000)
    await frames(3)
    const list = pages()[0]!
    navigate("/slow")
    await frames(10)
    expect(list.isConnected, "the list stays while the data loads").toBe(true)
    expect(Number(getComputedStyle(list).opacity), "and isn't leaving").toBeCloseTo(1, 3)
    resolve("loaded")
    await until(() => pages().some((p) => p.dataset.page === "slow"), 2000)
    await frames(3)
    expect(Number(getComputedStyle(list).opacity), "now it leaves").toBeLessThan(1)
    await until(() => !list.isConnected, 2000)
    expect(pages()[0]!.textContent).toContain("loaded")
  })
})

