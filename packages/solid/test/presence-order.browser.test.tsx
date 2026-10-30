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
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Arr from "effect/Array"
import { createSignal, For, type JSX, Show } from "solid-js"
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
    const [items, setItems] = createSignal(["a", "b", "c"])
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <ul style={{ ...FRAME, "list-style": "none" }}>
          <AnimatePresence>
            <For each={items()}>{(k) => <wardic.li data-k={k} {...LEAVE} style={{ height: "20px" }} />}</For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    await frames(3)
    setItems(["a", "d", "c"])
    await frames(3)
    expect(orderIn(container), "b back right after a, the child it followed").toEqual(["a", "b", "d", "c"])
  })

  it("PO4: several leavers keep their order, those that followed no staying child first", async () => {
    const [items, setItems] = createSignal(["a", "b", "c", "d"])
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <ul style={{ ...FRAME, "list-style": "none" }}>
          <AnimatePresence>
            <For each={items()}>{(k) => <wardic.li data-k={k} {...LEAVE} style={{ height: "20px" }} />}</For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    await frames(3)
    // a and b followed no staying child; e enters after c, the one that stays.
    setItems(["c", "e", "d"])
    await frames(3)
    expect(orderIn(container), "a and b first, in their order; then the rest").toEqual(["a", "b", "c", "e", "d"])
  })

  it("PO5: a leaver from an earlier change, still exiting, keeps its place", async () => {
    const [items, setItems] = createSignal(["a", "b", "c"])
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <ul style={{ ...FRAME, "list-style": "none" }}>
          <AnimatePresence>
            <For each={items()}>{(k) => <wardic.li data-k={k} {...LEAVE} style={{ height: "20px" }} />}</For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    await frames(3)
    setItems(["a", "c"])
    await frames(3)
    expect(orderIn(container), "b exiting in its place").toEqual(["a", "b", "c"])
    setItems(["c"])
    await frames(3)
    expect(orderIn(container), "a back before b, as it was").toEqual(["a", "b", "c"])
  })
})
