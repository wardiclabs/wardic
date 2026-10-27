// `<AnimatePresence mode="popLayout">` on Solid 1 (#277, ADR-0048), and the projection told when a
// leaver is popped or removed in any mode. Real frames.
//
// - PL1: a leaver is popped out of the flow where it was, and a `layout` sibling slides into its
//   space while it exits.
// - PL2: a sibling without `layout` takes its place at once.
// - PL3: `sync` (the gap fix): once the leaver is removed, a `layout` sibling slides into the gap,
//   where it jumped.
// - PL4: a leaver with margins is popped in place.
// - PL5: right to left: a leaver anchored at its inline start (the right) is popped in place, its
//   offsets from the viewport (a body with a margin, no positioned ancestor).
// - PL6: a child entering before the leaver in the same change: the leaver is popped where it was
//   before the change.
// - PL7: a switch: the new child is on the page at once, the leaver popped over it.
// - PL8: two neighbours removed at once, each popped in place.
// - PL9: inside a positioned container with padding and a border: popped in place.
// - PL10: an inline leaver, with no size of its own, isn't popped.
// - PL11: a leaver with no `layout` of its own: its siblings still slide (the presence tells the
//   projection; no layout node of the leaver's does).
// - PL12: right to left inside a positioned container with a border: popped in place.
// - PL13: a leaver whose stylesheet sets its position and size `!important` is popped in place all the same.
//
// A leaver's layout nodes go on projecting while it exits (#407, ADR-0048 *Amendment (#407)*), in a
// positioned `layout` card that shrinks or grows around it, as the storefront's questions do:
// - PL14: a `layout="position"` leaver popped out of a shrinking card is drawn where it was, at its own
//   size, every frame of its exit. Before, the card's scale stretched it (66 px drawn 141 px tall).
// - PL15: its exit's own translate is drawn on the correction.
// - PL16: the card landing first, it rests at its own box for the rest of its exit.
// - PL17: `sync` too: a child entering before it grows the card, and the leaver keeps its own size,
//   from where it was to its new place. Before, the card's scale squashed it.
// - PL18: `sync`, a child leaving while its card is already growing (no Measure pass at the leave):
//   corrected from the next frame on, not left with its last correction as the card's scale moves on.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition, type WardicValues } from "@wardic/solid"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

// The exit (the transition, #277) outlasts the siblings' layout slide (its `layout` key): the leaver
// still exits as they land.
const EXIT = { type: "tween", duration: 0.8, layout: { type: "tween", duration: 0.3 } } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

interface ListOptions {
  readonly mode?: "sync" | "popLayout"
  readonly layout?: boolean
  /** Items with no `layout` though the others have it. */
  readonly unlaid?: ReadonlyArray<string>
  readonly itemStyle?: JSX.CSSProperties
  readonly listStyle?: JSX.CSSProperties
  readonly dir?: "rtl"
}

/** A presence around a `<For>` of Wardic items, 40px tall, that fade out. */
const mountList = (start: ReadonlyArray<string>, options: ListOptions = {}) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const layoutOf = (item: string) =>
    Bool.match(Bool.and(options.layout === true, Bool.not(new Set(options.unlaid).has(item))), { onTrue: () => ({ layout: true }), onFalse: () => ({}) })
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <ul dir={options.dir} style={{ margin: "0", padding: "0", "list-style": "none", ...options.listStyle }}>
        <AnimatePresence mode={options.mode}>
          <For each={items()}>
            {(item) => (
              <wardic.li
                data-item={item}
                {...layoutOf(item)}
                exit={{ opacity: 0 }}
                transition={EXIT}
                style={{ display: "block", height: "40px", ...options.itemStyle }}
              >
                {item}
              </wardic.li>
            )}
          </For>
        </AnimatePresence>
      </ul>
    </WardicProvider>
  ))
  const node = (item: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${item}"]`)!
  return { setItems, node }
}

interface CardOptions {
  readonly mode: "sync" | "popLayout"
  readonly card: WardicTransition
  readonly exit: WardicValues
  readonly answer: WardicTransition
  /** A spacer's height under the answers, to grow the card with nothing above them moving. */
  readonly spacer?: () => number
}

/**
 * A positioned `layout` card, as the storefront's questions (#407): a 40px question, then a presence of
 * 60px `layout="position"` answers, each with `exit` on the `answer` transition.
 */
const mountCard = (start: ReadonlyArray<string>, options: CardOptions) => {
  const [answers, setAnswers] = createSignal<ReadonlyArray<string>>(start)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div data-card layout transition={options.card} style={{ position: "relative", width: "200px" }}>
        <div style={{ height: "40px" }}>question</div>
        <AnimatePresence mode={options.mode} initial={false}>
          <For each={answers()}>
            {(answer) => (
              <wardic.div data-item={answer} layout="position" exit={options.exit} transition={options.answer} style={{ width: "120px", height: "60px" }}>
                {answer}
              </wardic.div>
            )}
          </For>
        </AnimatePresence>
        <div style={{ height: `${UndefinedOr.match(options.spacer, { onUndefined: () => 0, onDefined: (spacer) => spacer() })}px` }} />
      </wardic.div>
    </WardicProvider>
  ))
  const node = (answer: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${answer}"]`)!
  const card = container.querySelector<HTMLElement>("[data-card]")!
  return { setAnswers, node, card }
}

/** Whether `el` has a transform: a `layout` card animating has one, and has `none` at rest. */
const transformed = (el: HTMLElement): boolean => getComputedStyle(el).transform !== "none"

/** Where `el` is drawn, rounded to a tenth of a pixel. */
const rectOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  const tenth = (n: number): number => Math.round(n * 10) / 10
  return { left: tenth(r.left), top: tenth(r.top), width: tenth(r.width), height: tenth(r.height) }
}

/** Watch `el`'s top over frames until `done`: whether it was seen strictly between `from` and `to`. */
const slides = async (el: HTMLElement, from: number, to: number, done: () => boolean): Promise<boolean> => {
  let sawMid = false
  const low = Math.min(from, to) + 3
  const high = Math.max(from, to) - 3
  await until(() => {
    const top = el.getBoundingClientRect().top
    if (top > low && top < high) sawMid = true
    return done()
  }, 3000)
  return sawMid
}

describe('AnimatePresence mode="popLayout" on Solid 1 (#277)', () => {
  it("PL1: popped where it was, and a layout sibling slides into its space", async () => {
    const list = mountList(["a", "b", "c"], { mode: "popLayout", layout: true })
    await frames(5)
    const b = list.node("b")
    const c = list.node("c")
    const bWas = rectOf(b)
    const cWas = c.getBoundingClientRect().top
    list.setItems(["a", "c"])
    expect(getComputedStyle(b).position, "out of the flow").toBe("absolute")
    expect(rectOf(b), "where it was").toEqual(bWas)
    await raf()
    expect(b.isConnected, "still exiting").toBe(true)
    const sawMid = await slides(c, cWas, bWas.top, () => Math.abs(c.getBoundingClientRect().top - bWas.top) < 0.5)
    expect(sawMid, "c slid into b's space").toBe(true)
    expect(b.isConnected, "b still exiting as c lands").toBe(true)
    await until(() => !b.isConnected, 3000)
    expect(b.isConnected).toBe(false)
  })

  it("PL2: a sibling without layout takes its place at once", async () => {
    const list = mountList(["a", "b", "c"], { mode: "popLayout" })
    await frames(5)
    const b = list.node("b")
    const bWas = rectOf(b)
    list.setItems(["a", "c"])
    await raf()
    expect(rectOf(list.node("c")).top, "at b's place").toBe(bWas.top)
    expect(rectOf(b), "b where it was").toEqual(bWas)
  })

  it("PL3: sync: once the leaver is removed, a layout sibling slides into the gap", async () => {
    const list = mountList(["a", "b", "c"], { layout: true })
    await frames(5)
    const b = list.node("b")
    const c = list.node("c")
    const bTop = b.getBoundingClientRect().top
    const cWas = c.getBoundingClientRect().top
    list.setItems(["a", "c"])
    await frames(3)
    expect(c.getBoundingClientRect().top, "c stays while b exits").toBeCloseTo(cWas, 0)
    await until(() => !b.isConnected, 3000)
    const sawMid = await slides(c, cWas, bTop, () => Math.abs(c.getBoundingClientRect().top - bTop) < 0.5)
    expect(sawMid, "c slid into the gap").toBe(true)
  })

  it("PL4: a leaver with margins is popped in place", async () => {
    const list = mountList(["a", "b", "c"], { mode: "popLayout", itemStyle: { margin: "10px 6px 4px 12px" } })
    await frames(5)
    const b = list.node("b")
    const bWas = rectOf(b)
    list.setItems(["a", "c"])
    expect(rectOf(b)).toEqual(bWas)
  })

  it("PL5: right to left: popped in place, anchored at its inline start", async () => {
    const margin = document.body.style.margin
    document.body.style.margin = "11px"
    try {
      const list = mountList(["a", "b", "c"], { mode: "popLayout", dir: "rtl", itemStyle: { width: "120px", "margin-inline-start": "9px" } })
      await frames(5)
      const b = list.node("b")
      expect(b.offsetParent, "offsets from the viewport").toBe(document.body)
      const bWas = rectOf(b)
      list.setItems(["a", "c"])
      expect(b.style.getPropertyValue("right"), "anchored right").not.toBe("")
      expect(rectOf(b)).toEqual(bWas)
    } finally {
      document.body.style.margin = margin
    }
  })

  it("PL6: a child entering before the leaver: popped where it was before the change", async () => {
    const list = mountList(["a", "b"], { mode: "popLayout" })
    await frames(5)
    const a = list.node("a")
    const aWas = rectOf(a)
    list.setItems(["z", "b"])
    expect(rectOf(a), "not pushed down by z").toEqual(aWas)
    expect(rectOf(list.node("z")).top, "z at the top").toBe(aWas.top)
  })

  it("PL7: a switch: the new child is on the page at once, the leaver popped over it", async () => {
    const [tab, setTab] = createSignal("a")
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div>
          <AnimatePresence mode="popLayout">
            <Show when={tab()} keyed>
              {(t) => (
                <wardic.section data-tab={t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT} style={{ height: "60px" }}>
                  {t}
                </wardic.section>
              )}
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    const node = (t: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-tab="${t}"]`)
    await until(() => Number(node("a")!.style.opacity) >= 0.99, 2000)
    const a = node("a")!
    const aWas = rectOf(a)
    setTab("b")
    const b = node("b")
    expect(b, "b on the page at once").not.toBeNull()
    expect(rectOf(b!).top, "in a's place").toBe(aWas.top)
    expect(rectOf(a), "a popped where it was").toEqual(aWas)
    await until(() => !a.isConnected, 3000)
    expect(rectOf(b!).top).toBe(aWas.top)
  })

  it("PL8: two neighbours removed at once, each popped in place", async () => {
    const list = mountList(["a", "b", "c", "d"], { mode: "popLayout" })
    await frames(5)
    const b = list.node("b")
    const c = list.node("c")
    const bWas = rectOf(b)
    const cWas = rectOf(c)
    list.setItems(["a", "d"])
    expect(rectOf(b)).toEqual(bWas)
    expect(rectOf(c)).toEqual(cWas)
  })

  it("PL9: inside a positioned container with padding and a border, popped in place", async () => {
    const list = mountList(["a", "b", "c"], {
      mode: "popLayout",
      listStyle: { position: "relative", padding: "13px 0 0 21px", border: "3px solid black", "margin-top": "17px" },
    })
    await frames(5)
    const b = list.node("b")
    const bWas = rectOf(b)
    list.setItems(["a", "c"])
    expect(rectOf(b)).toEqual(bWas)
  })

  it("PL10: an inline leaver, with no size of its own, isn't popped", async () => {
    const list = mountList(["a", "b", "c"], { mode: "popLayout", itemStyle: { display: "inline", height: "auto" } })
    await frames(5)
    const b = list.node("b")
    list.setItems(["a", "c"])
    expect(getComputedStyle(b).position).toBe("static")
    expect(b.isConnected, "it exits in the flow").toBe(true)
  })

  it("PL11: a leaver with no layout of its own: its siblings still slide", async () => {
    const list = mountList(["a", "b", "c"], { mode: "popLayout", layout: true, unlaid: ["b"] })
    await frames(5)
    const b = list.node("b")
    const c = list.node("c")
    const bTop = b.getBoundingClientRect().top
    const cWas = c.getBoundingClientRect().top
    list.setItems(["a", "c"])
    await raf()
    const sawMid = await slides(c, cWas, bTop, () => Math.abs(c.getBoundingClientRect().top - bTop) < 0.5)
    expect(sawMid, "c slid into b's space").toBe(true)
  })

  it("PL12: right to left inside a positioned container with a border: popped in place", async () => {
    const list = mountList(["a", "b", "c"], {
      mode: "popLayout",
      dir: "rtl",
      itemStyle: { width: "120px", "margin-inline-start": "9px" },
      listStyle: { position: "relative", border: "5px solid black", width: "300px" },
    })
    await frames(5)
    const b = list.node("b")
    const bWas = rectOf(b)
    list.setItems(["a", "c"])
    expect(rectOf(b)).toEqual(bWas)
  })

  it("PL13: a leaver whose stylesheet sets its position and size !important is popped in place", async () => {
    const sheet = document.createElement("style")
    sheet.textContent = "[data-item].stubborn { position: relative !important; width: 50% !important; top: 3px !important; left: 4px !important; }"
    document.head.append(sheet)
    try {
      const list = mountList(["a", "b", "c"], { mode: "popLayout" })
      await frames(5)
      const b = list.node("b")
      b.classList.add("stubborn")
      const bWas = rectOf(b)
      list.setItems(["a", "c"])
      expect(getComputedStyle(b).position).toBe("absolute")
      expect(rectOf(b)).toEqual(bWas)
    } finally {
      sheet.remove()
    }
  })

  it("PL14: a layout leaver popped out of a shrinking card is drawn where it was, at its own size, every frame", async () => {
    const t = mountCard(["a"], { mode: "popLayout", card: { type: "tween", duration: 0.5 }, exit: { opacity: 0 }, answer: { type: "tween", duration: 0.4 } })
    await frames(5)
    const a = t.node("a")
    const was = rectOf(a)
    t.setAnswers([])
    let shrinking = 0
    await until(() => {
      if (Bool.not(a.isConnected)) return true
      if (transformed(t.card)) shrinking++
      const now = rectOf(a)
      expect(now.height, "its own size").toBeCloseTo(was.height, 0)
      expect(now.top, "where it was").toBeCloseTo(was.top, 0)
      expect(now.left).toBeCloseTo(was.left, 0)
      return false
    }, 3000)
    expect(shrinking, "frames the card shrank around it").toBeGreaterThan(5)
    expect(a.isConnected, "gone at its exit's end").toBe(false)
  })

  it("PL15: its exit's own translate is drawn on the correction", async () => {
    const t = mountCard(["a"], { mode: "popLayout", card: { type: "tween", duration: 1 }, exit: { x: 100 }, answer: { type: "tween", duration: 1, ease: "linear" } })
    await frames(5)
    const a = t.node("a")
    const was = rectOf(a)
    t.setAnswers([])
    const lefts: Array<number> = []
    for (let i = 0; i < 10; i++) {
      await raf()
      const now = rectOf(a)
      expect(transformed(t.card), `frame ${i}: the card shrinking`).toBe(true)
      expect(now.height, `frame ${i}: its own size`).toBeCloseTo(was.height, 0)
      expect(now.top, `frame ${i}: where it was`).toBeCloseTo(was.top, 0)
      lefts.push(now.left - was.left)
    }
    expect(lefts.at(-1), "moved by its exit, px").toBeGreaterThan(5)
    expect(Arr.every(Arr.zip(lefts, Arr.drop(lefts, 1)), ([before, after]) => after >= before), "moving one way").toBe(true)
  })

  it("PL16: the card landing first, the leaver rests at its own box for the rest of its exit", async () => {
    const t = mountCard(["a"], { mode: "popLayout", card: { type: "tween", duration: 0.15 }, exit: { opacity: 0 }, answer: { type: "tween", duration: 1 } })
    await frames(5)
    const a = t.node("a")
    const was = rectOf(a)
    t.setAnswers([])
    await raf()
    expect(transformed(t.card), "the card shrinking").toBe(true)
    await until(() => Bool.not(transformed(t.card)), 3000)
    await frames(3)
    expect(a.isConnected, "still exiting").toBe(true)
    expect(rectOf(a), "its own box").toEqual(was)
    expect(transformed(a), "nothing left of the card's correction").toBe(false)
  })

  it("PL17: sync: a child entering before the leaver grows the card, and the leaver keeps its own size", async () => {
    const t = mountCard(["b"], { mode: "sync", card: { type: "tween", duration: 1, ease: "linear" }, exit: { opacity: 0 }, answer: { type: "tween", duration: 1 } })
    await frames(5)
    const b = t.node("b")
    const was = rectOf(b)
    t.setAnswers(["a"])
    await raf()
    expect(rectOf(b).top, "its first frame where it was").toBeCloseTo(was.top, 0)
    const heights: Array<number> = []
    await until(() => {
      if (Bool.not(transformed(t.card))) return true
      if (Bool.not(b.isConnected)) return true
      heights.push(rectOf(b).height)
      return Math.abs(rectOf(b).top - (was.top + was.height)) < 0.5
    }, 3000)
    expect(heights.length, "frames the card grew around it").toBeGreaterThan(5)
    expect(Arr.every(heights, (height) => Math.abs(height - was.height) < 0.5), `its own size: ${heights.join(", ")}`).toBe(true)
    expect(rectOf(b).top, "at its new place, under the child that entered").toBeCloseTo(was.top + was.height, 0)
  })

  it("PL18: sync: a child leaving while its card is already growing is corrected from the next frame on", async () => {
    const [spacer, setSpacer] = createSignal(0)
    const t = mountCard(["a"], { mode: "sync", card: { type: "tween", duration: 1, ease: "linear" }, exit: { opacity: 0 }, answer: { type: "tween", duration: 1 }, spacer })
    await frames(5)
    const a = t.node("a")
    const was = rectOf(a)
    setSpacer(60)
    await frames(5)
    expect(transformed(t.card), "the card growing").toBe(true)
    expect(rectOf(a).height, "corrected while live").toBeCloseTo(was.height, 0)
    t.setAnswers([])
    for (let i = 0; i < 10; i++) {
      await raf()
      const now = rectOf(a)
      expect(transformed(t.card), `frame ${i}: the card still growing`).toBe(true)
      expect(now.height, `frame ${i}: its own size`).toBeCloseTo(was.height, 0)
      expect(now.top, `frame ${i}: where it was`).toBeCloseTo(was.top, 0)
    }
  })
})
