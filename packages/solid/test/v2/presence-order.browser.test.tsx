// Where `<AnimatePresence>` puts a leaving child back, and its input, on Solid 2 (#486, #675): Solid
// 1's PO1, PO3, PO6 and PO7, with `wardic.*`.
//
// - POV1: a page swap under `popLayout`: the leaving page before the new one, taking no input, and a
//   point over both hits the new page.
// - POV2: Motion's list example: `[a, b, c]` to `[a, d, c]` renders `[a, b (leaving), d, c]`.
// - POV3: a reorder while a child exits (#675): `[a, b, c]` to `[a, c]`, then `[c, a]` within b's
//   exit, renders `[c, a, b (leaving)]`, Solid 1's PO6. It passed before #675: Solid 2's reconcile
//   moves its nodes around this one leaver the other way.
// - POV4: two leavers through a reverse and an insert keep Motion's places, Solid 1's PO7. Before
//   #675 the reverse left them `[e, c, a, b, d]`, where Motion draws `[e, c, a, d, b]`.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Arr from "effect/Array"
import { createSignal, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const LEAVE = { exit: { opacity: 0 }, transition: { type: "tween", duration: 0.8, ease: "linear" } } as const
const FRAME: JSX.CSSProperties = { position: "relative", "margin-left": "120px", "margin-top": "120px", width: "300px" }
const PAGE: JSX.CSSProperties = { display: "block", width: "300px", height: "200px" }

const orderIn = (root: Element): ReadonlyArray<string> => Arr.map(Array.from(root.querySelectorAll<HTMLElement>("[data-k]")), (el) => el.dataset.k ?? "")
const hitAt = (el: Element): string | undefined => {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit?.closest<HTMLElement>("[data-k]")?.dataset.k
}

/** A presence over a keyed `<For>` of `wardic.li`s, each with {@link LEAVE}'s slow exit. */
const mountList = (first: ReadonlyArray<string>) => {
  const [items, setItems] = createSignal(first)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <ul style={{ ...FRAME, "list-style": "none" }}>
        <AnimatePresence>
          <For each={items()}>{(k) => <wardic.li data-k={k} {...LEAVE} style={{ height: "20px" }} />}</For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  return { to: setItems, host }
}

describe("where a leaver goes back, and its input, on Solid 2 (#486)", () => {
  it("POV1: popLayout: the leaving page before the new one, taking no input; a point over both hits the new page", async () => {
    const [page, setPage] = createSignal<"old" | "new">("old")
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div style={FRAME}>
          <AnimatePresence mode="popLayout">
            <Show when={page() === "old"} fallback={<wardic.main data-k="new" {...LEAVE} style={{ ...PAGE, background: "teal" }} />}>
              <wardic.main data-k="old" {...LEAVE} style={{ ...PAGE, background: "orange" }} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(3)
    const old = host.querySelector<HTMLElement>("[data-k=old]")!
    setPage("new")
    await frames(3)
    expect(old.isConnected, "the old page still leaving").toBe(true)
    expect(orderIn(host), "the leaver before the page that replaced it").toEqual(["old", "new"])
    expect(getComputedStyle(old).pointerEvents, "taking no input").toBe("none")
    expect(hitAt(host.querySelector("[data-k=new]")!), "a point over both hits the new page").toBe("new")
  })

  it("POV2: Motion's list example: [a, b, c] to [a, d, c] renders [a, b (leaving), d, c]", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "d", "c"])
    await frames(3)
    expect(orderIn(m.host), "b back right after a, the child it followed").toEqual(["a", "b", "d", "c"])
  })

  it("POV3: [a, b, c] to [a, c], then [c, a] within b's exit, renders [c, a, b (leaving)] (#675)", async () => {
    const m = mountList(["a", "b", "c"])
    await frames(3)
    m.to(["a", "c"])
    await frames(3)
    expect(orderIn(m.host), "b exiting in its place").toEqual(["a", "b", "c"])
    m.to(["c", "a"])
    await frames(3)
    expect(orderIn(m.host), "b after a, the child it followed, not between the moved nodes").toEqual(["c", "a", "b"])
  })

  it("POV4: two leavers through a reverse and an insert keep Motion's places (#675)", async () => {
    const m = mountList(["a", "b", "c", "d", "e"])
    await frames(3)
    m.to(["a", "c", "e"])
    await frames(3)
    expect(orderIn(m.host), "b and d exiting in their places").toEqual(["a", "b", "c", "d", "e"])
    m.to(["e", "c", "a"])
    await frames(3)
    expect(orderIn(m.host), "the reverse, the leavers at Motion's places").toEqual(["e", "c", "a", "d", "b"])
    m.to(["e", "x", "c", "a"])
    await frames(3)
    expect(orderIn(m.host), "x entered, the leavers kept after a").toEqual(["e", "x", "c", "a", "d", "b"])
  })
})
