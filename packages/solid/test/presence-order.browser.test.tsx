// Where `<AnimatePresence>` puts a leaving child back, and what input it takes (#486, ADR-0048
// *Amendment (#486)*). Motion's order: right after the staying child it followed before the change,
// or first if none did, leavers keeping their old order and entering children after them. A leaver
// `popLayout` pops takes no pointer input, so what took its place gets its clicks (not Motion's: its
// popped child still takes them). Before #486 a leaver went back after the child that replaced it,
// and a popped one, painted over the new page, took its clicks. Solid 2's are POV1–.
//
// - PO1: a page swap under `popLayout`: the leaving page before the new one, and a point over both
//   hits the new page, static as it is, while the leaver exits.
// - PO2: under `sync`: the leaver above the newcomer in the flow, and it keeps its input there.
// - PO3: Motion's list example: `[a, b, c]` to `[a, d, c]` renders `[a, b (leaving), d, c]`.
// - PO4: several leavers keep their order, those that followed no staying child first.
// - PO5: a leaver from an earlier change, still exiting, keeps its place: `a` leaving after it
//   goes back before it, as `a` was.
//
// A reorder while a child exits (#675): Solid moves its own nodes around the leaver, and the presence
// puts every leaver back at its place in Motion's order after each change, an earlier one too.
// - PO6: `[a, b, c]` to `[a, c]`, then `[c, a]` within b's exit, renders `[c, a, b (leaving)]`, not
//   `[c, b, a]` with b left between the moved nodes.
// - PO7: two leavers (b, d) through a reverse and an insert: `[e, x, c, a, d, b]`, Motion's places,
//   each leaver placed against one already in its place.
// - PO8: PO6 under `popLayout`: the popped leaver, out of the flow, still in Motion's order.
// - PO9: a change that leaves the leavers' places alone moves neither (no removal and insertion that
//   would cost a focus inside one, or restart its CSS animations): one first, before every child that
//   stays, and one after a child that stays.
// - PO10: PO6's list then emptied: Solid clears the list's whole parent, b with it, and every leaver
//   goes back in Motion's order, `[c, a, b]`, b after a as it was drawn.
// - PO11: PO6 with b a twin crossfading onto its other twin (`sync`): moved a slot down by the
//   reorder, it stays drawn on its Lead, the projection told it moved.
// - PO12: a child entering into an earlier leaver's gap, `[a, c]` to `[a, d, c]` with b exiting: b
//   stays right after a, `[a, b, d, c]`, Motion's, where Solid inserts d before it.
// - PO13: PO10 with a sibling after the presence: Solid empties the list around b, leaving it on the
//   page, and c and a go back before it, not after the sibling.
// - PO14: a list emptied beside a sibling, no leaver left on the page: they go back before the
//   sibling, where the list ended.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { batch, createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
// A slow, linear exit: the leaver is still on the page for every check.
const LEAVE = { exit: { opacity: 0 }, transition: { type: "tween", duration: 0.8, ease: "linear" } } as const
// Clear of the page's one mouse, parked at (5, 5).
const FRAME: JSX.CSSProperties = { position: "relative", "margin-left": "120px", "margin-top": "120px", width: "300px" }
const PAGE: JSX.CSSProperties = { display: "block", width: "300px", height: "200px" }

/** The keys of the elements under `root` with `data-k`, in DOM order. */
const orderIn = (root: Element): ReadonlyArray<string> => Arr.map(Array.from(root.querySelectorAll<HTMLElement>("[data-k]")), (el) => el.dataset.k ?? "")

/** The `data-k` of what a point at the middle of `el`'s box hits, or of its nearest ancestor with one. */
const hitAt = (el: Element): string | undefined => {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit?.closest<HTMLElement>("[data-k]")?.dataset.k
}

/** Two pages swapped under a presence of `mode`, each a plain, static block. */
const mountPages = (mode: "sync" | "popLayout") => {
  const [page, setPage] = createSignal<"old" | "new">("old")
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={FRAME} data-root>
        <AnimatePresence mode={mode}>
          <Show when={page() === "old"} fallback={<wardic.main data-k="new" {...LEAVE} style={{ ...PAGE, background: "teal" }} />}>
            <wardic.main data-k="old" {...LEAVE} style={{ ...PAGE, background: "orange" }} />
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  const q = (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
  return { to: setPage, q, root: container.querySelector("[data-root]")! }
}

/**
 * A presence over a keyed `<For>` of `wardic.li`s, each with {@link LEAVE}'s slow exit; with
 * `sibling`, a plain `li` after the presence in the same list (`data-k="S"`).
 */
const mountList = (first: ReadonlyArray<string>, mode: "sync" | "popLayout" = "sync", sibling = false) => {
  const [items, setItems] = createSignal(first)
  const presence = (): JSX.Element => (
    <AnimatePresence mode={mode}>
      <For each={items()}>{(k) => <wardic.li data-k={k} {...LEAVE} style={{ height: "20px" }} />}</For>
    </AnimatePresence>
  )
  // Alone in the list, the presence's children are all Solid puts there: emptied, it clears the list
  // (`textContent`), leavers too. Beside a sibling, Solid empties it around them, before the sibling.
  const list = (): JSX.Element =>
    Bool.match(sibling, {
      onTrue: () => (
        <ul style={{ ...FRAME, "list-style": "none" }}>
          {presence()}
          <li data-k="S" style={{ height: "20px" }} />
        </ul>
      ),
      onFalse: () => <ul style={{ ...FRAME, "list-style": "none" }}>{presence()}</ul>,
    })
  const { container } = render(() => <WardicProvider env={DomLive}>{list()}</WardicProvider>)
  return { to: setItems, list: container.querySelector("ul")! }
}

describe("where a leaver goes back, and its input (#486)", () => {
  it("PO1: popLayout: the leaving page before the new one, and a point over both hits the new page", async () => {
    const m = mountPages("popLayout")
    await frames(3)
    const old = m.q("old")
    m.to("new")
    await frames(3)
    expect(old.isConnected, "the old page still leaving").toBe(true)
    expect(orderIn(m.root), "the leaver before the page that replaced it").toEqual(["old", "new"])
    expect(getComputedStyle(old).position, "popped").toBe("absolute")
    expect(getComputedStyle(old).pointerEvents, "taking no input").toBe("none")
    expect(hitAt(m.q("new")), "a point over both hits the new page").toBe("new")
  })

  it("PO2: sync: the leaver above the newcomer in the flow, still taking its input", async () => {
    const m = mountPages("sync")
    await frames(3)
    const old = m.q("old")
    m.to("new")
    await frames(3)
    expect(orderIn(m.root), "the leaver first").toEqual(["old", "new"])
    expect(m.q("new").getBoundingClientRect().top - old.getBoundingClientRect().bottom, "the newcomer below it, px").toBeCloseTo(0, 0)
    expect(getComputedStyle(old).pointerEvents, "in the flow, it keeps its input").not.toBe("none")
  })

  it("PO3: Motion's list example: [a, b, c] to [a, d, c] renders [a, b (leaving), d, c]", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "d", "c"])
    await frames(3)
    expect(orderIn(m.list), "b back right after a, the child it followed").toEqual(["a", "b", "d", "c"])
  })

  it("PO4: several leavers keep their order, those that followed no staying child first", async () => {
    const m = mountList(["a", "b", "c", "d"])
    await frames(3)
    // a and b followed no staying child; e enters after c, the one that stays.
    m.to(["c", "e", "d"])
    await frames(3)
    expect(orderIn(m.list), "a and b first, in their order; then the rest").toEqual(["a", "b", "c", "e", "d"])
  })

  it("PO5: a leaver from an earlier change, still exiting, keeps its place", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "c"])
    await frames(3)
    expect(orderIn(m.list), "b exiting in its place").toEqual(["a", "b", "c"])
    m.to(["c"])
    await frames(3)
    expect(orderIn(m.list), "a back before b, as it was").toEqual(["a", "b", "c"])
  })
})

describe("a reorder while a child exits (#675)", () => {
  it("PO6: [a, b, c] to [a, c], then [c, a] within b's exit, renders [c, a, b (leaving)]", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "c"])
    await frames(3)
    expect(orderIn(m.list), "b exiting in its place").toEqual(["a", "b", "c"])
    m.to(["c", "a"])
    await frames(3)
    expect(orderIn(m.list), "b after a, the child it followed, not between the moved nodes").toEqual(["c", "a", "b"])
  })

  it("PO7: two leavers through a reverse and an insert keep Motion's places", async () => {
    const m = mountList(["a", "b", "c", "d", "e"])
    await frames(3)
    m.to(["a", "c", "e"])
    await frames(3)
    expect(orderIn(m.list), "b and d exiting in their places").toEqual(["a", "b", "c", "d", "e"])
    // Motion's arithmetic (#675): a sets the place b goes to, after a; c sets it after a again, d
    // going after a and before b, the leaver put back there already.
    m.to(["e", "c", "a"])
    await frames(3)
    expect(orderIn(m.list), "the reverse, the leavers at Motion's places").toEqual(["e", "c", "a", "d", "b"])
    m.to(["e", "x", "c", "a"])
    await frames(3)
    expect(orderIn(m.list), "x entered, the leavers kept after a").toEqual(["e", "x", "c", "a", "d", "b"])
  })

  it("PO8: popLayout: [a, b, c] to [a, c], then [c, a] within b's exit, renders [c, a, b (popped)]", async () => {
    const m = mountList(["a", "b", "c"], "popLayout")
    await frames(3)
    const b = m.list.querySelector<HTMLElement>("[data-k=b]")!
    m.to(["a", "c"])
    await frames(3)
    expect(getComputedStyle(b).position, "popped").toBe("absolute")
    expect(orderIn(m.list), "b exiting in its place").toEqual(["a", "b", "c"])
    m.to(["c", "a"])
    await frames(3)
    expect(b.isConnected, "b still leaving").toBe(true)
    expect(orderIn(m.list), "b after a, the child it followed").toEqual(["c", "a", "b"])
  })

  it("PO9: a change that leaves the leavers' places alone moves neither", async () => {
    const m = mountList(["a", "b", "c", "d"])
    await frames(3)
    m.to(["b", "d"])
    await frames(3)
    expect(orderIn(m.list), "a first, c after b, both exiting").toEqual(["a", "b", "c", "d"])
    const records: Array<MutationRecord> = []
    const observer = new MutationObserver((batch) => records.push(...batch))
    observer.observe(m.list, { childList: true })
    m.to(["b", "d", "e"])
    await frames(3)
    records.push(...observer.takeRecords())
    observer.disconnect()
    expect(orderIn(m.list), "e entered at the end").toEqual(["a", "b", "c", "d", "e"])
    const touched = Arr.filter(
      Arr.flatMap(records, (record) => [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]),
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    expect(Arr.filter(Arr.map(touched, (el) => el.dataset.k), (k) => k === "a" || k === "c"), "no leaver removed and put back").toEqual([])
  })

  it("PO10: the list emptied after a reorder: every leaver back in Motion's order", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "c"])
    await frames(3)
    m.to(["c", "a"])
    await frames(3)
    expect(orderIn(m.list), "b after a").toEqual(["c", "a", "b"])
    m.to([])
    await frames(3)
    expect(orderIn(m.list), "all three exiting, b still after a").toEqual(["c", "a", "b"])
  })

  it("PO11: a twin leaver moved a slot by the reorder stays drawn on its Lead", async () => {
    const [items, setItems] = createSignal(["a", "b", "c"])
    const [detail, setDetail] = createSignal(false)
    const flight = { layout: { type: "tween", duration: 0.8, ease: "linear" } } as const
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={FRAME}>
          <ul style={{ "list-style": "none", margin: "0", padding: "0" }}>
            <AnimatePresence>
              <For each={items()}>
                {(k) => (
                  <Show when={k === "b"} fallback={<wardic.li data-k={k} style={{ height: "20px", width: "100px" }} />}>
                    <wardic.li data-k={k} layoutId="po11" transition={flight} style={{ height: "20px", width: "100px" }} />
                  </Show>
                )}
              </For>
            </AnimatePresence>
          </ul>
          <Show when={detail()}>
            <wardic.div data-k="detail" layoutId="po11" transition={flight} style={{ "margin-top": "100px", height: "80px", width: "200px" }} />
          </Show>
        </div>
      </WardicProvider>
    ))
    await frames(3)
    const b = container.querySelector<HTMLElement>("[data-k=b]")!
    // b leaves as its twin enters: it crossfades onto it, drawn on its flight.
    batch(() => {
      setItems(["a", "c"])
      setDetail(true)
    })
    await frames(6)
    const lead = container.querySelector<HTMLElement>("[data-k=detail]")!
    const apart = (): number => {
      const [r, l] = [b.getBoundingClientRect(), lead.getBoundingClientRect()]
      return Math.max(Math.abs(r.left - l.left), Math.abs(r.top - l.top), Math.abs(r.right - l.right), Math.abs(r.bottom - l.bottom))
    }
    expect(apart(), "on its Lead before the reorder, px").toBeLessThan(1)
    setItems(["c", "a"])
    await frames(3)
    expect(orderIn(container), "b moved after a").toEqual(["c", "a", "b", "detail"])
    expect(b.isConnected, "still crossfading").toBe(true)
    expect(apart(), "still on its Lead, px").toBeLessThan(1)
  })

  it("PO12: a child entering into an earlier leaver's gap goes after it, Motion's", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "c"])
    await frames(3)
    m.to(["a", "d", "c"])
    await frames(3)
    expect(orderIn(m.list), "b right after a, the child it followed; d after it").toEqual(["a", "b", "d", "c"])
  })

  it("PO13: the list emptied after a reorder, beside a sibling: the leavers stay before it", async () => {
    const m = mountList(["a", "b", "c"], "sync", true)
    await frames(3)
    m.to(["a", "c"])
    await frames(3)
    m.to(["c", "a"])
    await frames(3)
    expect(orderIn(m.list), "b after a, the sibling last").toEqual(["c", "a", "b", "S"])
    m.to([])
    await frames(3)
    expect(orderIn(m.list), "all three exiting before the sibling").toEqual(["c", "a", "b", "S"])
  })

  it("PO14: a list emptied beside a sibling, no leaver left on the page: back before the sibling", async () => {
    const m = mountList(["a", "b"], "sync", true)
    await frames(3)
    m.to([])
    await frames(3)
    expect(orderIn(m.list), "both exiting where the list was").toEqual(["a", "b", "S"])
  })
})
