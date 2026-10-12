// Regression: nested draggables (issue #29, ADR-0019 *Amendment (#29)*). Real Playwright mouse
// input (`commands.realMouse`): a synthetic event bubbles only with `bubbles: true`, and only
// the browser's own dispatch shows which listener a move reaches first.
//
// Before #29, a `pointerdown` on an inner draggable bubbled to its draggable ancestor and both
// drag recognizers took the gesture: grabbing I dragged O too (free I rode O and moved twice).
// Now a drag takes its target's **Drag claim** on its axes at its start; the innermost claims
// first, and a drag that needs an axis another target holds is refused for its whole gesture.
// framer-motion 13.4.0 measured the same scenes, real mouse, Chromium 147 and Firefox 148
// (`.tmp/29-nested/`): each expectation below is Motion's, except where a test says otherwise.
// NC4.4, NC5, NC6, NC9 and NC10.2 pin what main already did and the claim keeps: drags on
// different axes, presses that end at the release, dragPropagation, and the grab.
//
// The scene: an outer draggable O (240x180 at 60,80) holds an inner draggable I (90x70, 30 px in
// from O's top-left). Each shows its gestures as styles on a 50 ms tween: whileDrag fades it to
// 0.5, whileHover sets its background, whileTap its text colour. Every browser file shares the
// page's one mouse, parked at (5, 5), so the scene sits clear of it.
import { cleanup, render } from "@solidjs/testing-library"
import type * as Drag from "@wardic/core/Drag"
import { DomLive } from "@wardic/dom"
import { createDrag, Reorder, wardic, WardicProvider } from "@wardic/solid"
import { createEffect, createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, raf } from "./browser-helpers.ts"

interface Pt {
  readonly x: number
  readonly y: number
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

// Whether the button is held, so a test that fails mid-press still releases it.
let held = false
const mouse = {
  move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
  down: async (p: Pt): Promise<void> => {
    await commands.realMouse("down", p.x, p.y)
    held = true
  },
  up: async (p: Pt): Promise<void> => {
    await commands.realMouse("up", p.x, p.y)
    held = false
  },
}

afterEach(async () => {
  if (held) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  cleanup()
})

const BASE = { outer: "rgb(204, 204, 204)", inner: "rgb(136, 204, 255)" }
const HOVER = { outer: "rgb(255, 0, 0)", inner: "rgb(0, 160, 0)" }
const TAP = "rgb(0, 0, 255)"
const T = { type: "tween", duration: 0.05 } as const

type Axis = boolean | "x" | "y"

interface NodeSpec {
  readonly drag: Axis
  readonly layout?: boolean
  readonly propagation?: boolean
  readonly snapToOrigin?: boolean
  /** Keep the default spring instead of the 50 ms tween (NC9's snap-back has to last). */
  readonly springy?: boolean
}

/** The motion props of a scene node: its drag, and its gestures shown as styles. */
const motionProps = (spec: NodeSpec, who: "outer" | "inner") => ({
  drag: spec.drag,
  layout: spec.layout === true,
  dragPropagation: spec.propagation === true,
  dragMomentum: false,
  dragSnapToOrigin: spec.snapToOrigin === true,
  whileDrag: { opacity: 0.5 },
  whileHover: { "background-color": HOVER[who] },
  whileTap: { color: TAP },
  ...(spec.springy === true ? {} : { transition: T }),
})

interface Scene {
  readonly outer: () => HTMLElement
  readonly inner: () => HTMLElement
  /** Unmount I (mid-drag, for NC8). */
  readonly dropInner: () => void
}

const mountScene = async (outer: NodeSpec, inner: NodeSpec, extra?: (o: HTMLElement) => JSX.Element): Promise<Scene> => {
  let o: HTMLElement | undefined
  let i: HTMLElement | undefined
  const [showInner, setShowInner] = createSignal(true)
  const [outerEl, setOuterEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", left: "60px", top: "80px" }}>
        <wardic.div
          ref={(el: HTMLElement) => {
            o = el
            setOuterEl(el)
          }}
          {...motionProps(outer, "outer")}
          style={{ position: "relative", width: "240px", height: "180px", background: BASE.outer, color: "rgb(0, 0, 0)" }}
        >
          <Show when={showInner()}>
            <wardic.div
              ref={(el: HTMLElement) => (i = el)}
              {...motionProps(inner, "inner")}
              style={{ position: "absolute", left: "30px", top: "30px", width: "90px", height: "70px", background: BASE.inner, color: "rgb(0, 0, 0)" }}
            >
              I
            </wardic.div>
          </Show>
        </wardic.div>
      </div>
      <Show when={extra !== undefined && outerEl()}>{(el) => extra!(el())}</Show>
    </WardicProvider>
  ))
  await settle()
  await wait(100)
  return { outer: () => o!, inner: () => i!, dropInner: () => setShowInner(false) }
}

/** An element's place and which gestures it shows: D whileDrag, H whileHover, T whileTap. */
interface Reading {
  readonly left: number
  readonly top: number
  readonly flags: string
}

const readOf = (el: HTMLElement, who: "outer" | "inner"): Reading => {
  const b = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const flags = [Number(cs.opacity) < 0.75 && "D", cs.backgroundColor !== BASE[who] && "H", cs.color === TAP && "T"]
    .filter(Boolean)
    .join("")
  return { left: b.left, top: b.top, flags }
}

/** How far `now` is from `before`, rounded, and its flags: `"60,30 DHT"`. */
const moved = (before: Reading, now: Reading): string =>
  [`${Math.round(now.left - before.left)},${Math.round(now.top - before.top)}`, now.flags].filter((s) => s !== "").join(" ")

const centreOf = (el: Element): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}

/** O's grab point: inside O, clear of I. */
const outerGrab = (o: HTMLElement): Pt => {
  const b = o.getBoundingClientRect()
  return { x: b.left + 200, y: b.top + 140 }
}

/** Move the real mouse from `from` by `(dx, dy)` in `steps` moves, ~16 ms apart. */
const glide = async (from: Pt, dx: number, dy: number, steps = 10): Promise<Pt> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + (dx * k) / steps, y: from.y + (dy * k) / steps })
    await wait(16)
  }
  return { x: from.x + dx, y: from.y + dy }
}

interface Gesture {
  /** O and I while held, against where they were before the down. */
  readonly held: { readonly outer: string; readonly inner: string }
  /** O and I 300 ms after the release, against where they were before the down. */
  readonly after: { readonly outer: string; readonly inner: string }
}

/** Hover `at`, press, glide +60,+30, read while held, release, read after. */
const gesture = async (s: Scene, at: Pt, inner: () => HTMLElement = s.inner): Promise<Gesture> => {
  await mouse.move(at)
  await wait(120)
  const before = { outer: readOf(s.outer(), "outer"), inner: readOf(inner(), "inner") }
  await mouse.down(at)
  await wait(30)
  const end = await glide(at, 60, 30)
  await wait(150)
  const heldNow = {
    outer: moved(before.outer, readOf(s.outer(), "outer")),
    inner: moved(before.inner, readOf(inner(), "inner")),
  }
  await mouse.up(end)
  await wait(300)
  return {
    held: heldNow,
    after: { outer: moved(before.outer, readOf(s.outer(), "outer")), inner: moved(before.inner, readOf(inner(), "inner")) },
  }
}

describe("nested draggables: the innermost claims the drag (#29)", () => {
  it("NC1: free in free: grabbing I drags I alone; O keeps its hover and press; O drags when grabbed itself, and I again after", async () => {
    const s = await mountScene({ drag: true }, { drag: true })
    // I: O stays, showing hover and press but not drag; I follows the pointer.
    const first = await gesture(s, centreOf(s.inner()))
    expect(first.held).toEqual({ outer: "0,0 HT", inner: "60,30 DHT" })
    // After the release: O's press is over, I rests where it was dropped.
    expect(first.after).toEqual({ outer: "0,0 H", inner: "60,30 H" })
    // O: the claim was released at I's release, so O drags, and I rides it.
    const second = await gesture(s, outerGrab(s.outer()))
    expect(second.held).toEqual({ outer: "60,30 DHT", inner: "60,30" })
    // I again: refused only for O's gesture, it claims again.
    const third = await gesture(s, centreOf(s.inner()))
    expect(third.held).toEqual({ outer: "0,0 HT", inner: "60,30 DHT" })
  })

  it("NC2: layout in layout: grabbing I leaves O on its slot; I flies back to its slot on release (ADR-0016)", async () => {
    const s = await mountScene({ drag: true, layout: true }, { drag: true, layout: true })
    const slot = readOf(s.inner(), "inner")
    const first = await gesture(s, centreOf(s.inner()))
    expect(first.held).toEqual({ outer: "0,0 HT", inner: "60,30 DHT" })
    // Wardic's layout drag returns to its slot (Motion's keeps the offset): ADR-0016, not #29.
    await wait(600)
    expect(moved(slot, readOf(s.inner(), "inner")).split(" ")[0]).toBe("0,0")
    const second = await gesture(s, outerGrab(s.outer()))
    expect(second.held.outer).toBe("60,30 DHT")
  })

  it("NC3: mixed nesting: a layout I in a free O, and a free I in a layout O, drag I alone", async () => {
    const freeOuter = await mountScene({ drag: true }, { drag: true, layout: true })
    expect((await gesture(freeOuter, centreOf(freeOuter.inner()))).held).toEqual({ outer: "0,0 HT", inner: "60,30 DHT" })
    cleanup()
    await mouse.move({ x: 5, y: 5 })
    const layoutOuter = await mountScene({ drag: true, layout: true }, { drag: true })
    expect((await gesture(layoutOuter, centreOf(layoutOuter.inner()))).held).toEqual({ outer: "0,0 HT", inner: "60,30 DHT" })
  })
})

describe("per-axis claims (#29, Motion's setDragLock)", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly outer: Axis; readonly inner: Axis; readonly expected: Gesture["held"] }> = [
    // I claims x, O needs x: refused.
    { name: "x in x: I alone", outer: "x", inner: "x", expected: { outer: "0,0 HT", inner: "60,0 DHT" } },
    // I claims x, O (free) needs x and y: refused.
    { name: "x in free: I alone", outer: true, inner: "x", expected: { outer: "0,0 HT", inner: "60,0 DHT" } },
    // I claims both, O needs x: refused.
    { name: "free in x: I alone", outer: "x", inner: true, expected: { outer: "0,0 HT", inner: "60,30 DHT" } },
    // I claims y, O claims x: both drag, each on its axis (I rides O's x).
    { name: "y in x: both, each on its axis", outer: "x", inner: "y", expected: { outer: "60,0 DHT", inner: "60,30 DHT" } },
  ]
  for (const [n, c] of cases.entries()) {
    it(`NC4.${n + 1}: ${c.name}`, async () => {
      const s = await mountScene({ drag: c.outer }, { drag: c.inner })
      expect((await gesture(s, centreOf(s.inner()))).held).toEqual(c.expected)
    })
  }

  it("NC5: two drags at once end their presses at the release (Motion leaves I's whileTap on)", async () => {
    const s = await mountScene({ drag: "x" }, { drag: "y" })
    const g = await gesture(s, centreOf(s.inner()))
    expect(g.held).toEqual({ outer: "60,0 DHT", inner: "60,30 DHT" })
    // Motion 13.4.0 measured `I 60,30 HT` here: its press end is ignored while a lock is held.
    expect(g.after).toEqual({ outer: "60,0 H", inner: "60,30 H" })
  })
})

describe("dragPropagation and createDrag's claim (#29)", () => {
  it("NC6: dragPropagation on I: it claims nothing, so O drags with it, as before #29 and as in Motion", async () => {
    const s = await mountScene({ drag: true }, { drag: true, propagation: true })
    expect((await gesture(s, centreOf(s.inner()))).held).toEqual({ outer: "60,30 DHT", inner: "120,60 DHT" })
  })

  it("NC7: a createDrag on O is refused while I drags; with claim: false it sees the gesture and blocks nothing", async () => {
    const claiming: Array<Drag.Sample> = []
    const watching: Array<Drag.Sample> = []
    function Recorder(props: { readonly target: HTMLElement }) {
      // eslint-disable-next-line solid/reactivity
      const claimed = createDrag(props.target)
      // eslint-disable-next-line solid/reactivity
      const watched = createDrag(props.target, { claim: false })
      createEffect(() => {
        const sample = claimed()
        if (sample !== null) claiming.push(sample)
      })
      createEffect(() => {
        const sample = watched()
        if (sample !== null) watching.push(sample)
      })
      return null
    }
    // O is not draggable here: a plain recorder target, with a draggable I in it.
    const s = await mountScene({ drag: false }, { drag: true }, (o) => <Recorder target={o} />)
    const g = await gesture(s, centreOf(s.inner()))
    expect(g.held.inner).toBe("60,30 DHT")
    // The claiming recorder shares O's target, which was refused: no sample at all.
    expect(claiming).toEqual([])
    // The watcher saw the whole gesture.
    expect(watching.map((sample) => sample.phase)).toContain("start")
    expect(watching.at(-1)?.phase).toBe("end")
  })
})

describe("the claim's release, and the grab (#29)", () => {
  it("NC8: I unmounts mid-drag: O stays still for the rest of the gesture, then drags on its own grab", async () => {
    const s = await mountScene({ drag: true }, { drag: true })
    const at = centreOf(s.inner())
    await mouse.move(at)
    await wait(120)
    const before = readOf(s.outer(), "outer")
    await mouse.down(at)
    const mid = await glide(at, 30, 15, 5)
    // I is dragged and O refused; now I goes, and with it its claim.
    s.dropInner()
    await settle()
    const end = await glide(mid, 30, 15, 5)
    await wait(150)
    // O was refused for this gesture, so it doesn't start mid-way.
    expect(moved(before, readOf(s.outer(), "outer"))).toBe("0,0 HT")
    await mouse.up(end)
    await wait(300)
    // The unmount released I's claim: O's own grab drags it.
    const at2 = outerGrab(s.outer())
    await mouse.move(at2)
    await wait(120)
    const before2 = readOf(s.outer(), "outer")
    await mouse.down(at2)
    const end2 = await glide(at2, 60, 30)
    await wait(150)
    expect(moved(before2, readOf(s.outer(), "outer"))).toBe("60,30 DHT")
    await mouse.up(end2)
  })

  it("NC9: a grab on I still stops O's running release where it is, as Motion's session start does", async () => {
    // O springs back to its origin on release; I is pressed while it does.
    const s = await mountScene({ drag: true, snapToOrigin: true, springy: true }, { drag: true })
    const at = outerGrab(s.outer())
    await mouse.move(at)
    await wait(120)
    const rest = readOf(s.outer(), "outer")
    await mouse.down(at)
    const end = await glide(at, 120, 0, 8)
    await mouse.up(end)
    // Mid-flight, press I (where it is now) and hold still.
    await raf()
    await raf()
    await raf()
    await mouse.down(centreOf(s.inner()))
    const stopped = moved(rest, readOf(s.outer(), "outer"))
    await wait(150)
    // O stopped where the grab caught it: off its origin, and it hasn't moved since.
    expect(moved(rest, readOf(s.outer(), "outer")).split(" ")[0]).toBe(stopped.split(" ")[0])
    expect(Number(stopped.split(",")[0])).toBeGreaterThan(5)
  })
})

describe("<Reorder> items are drags too (#29, ADR-0020)", () => {
  // Items 50 px tall, 10 px apart: the gesture's +30 px leaves item a short of b's centre, so
  // nothing reorders (a reorder inside a card dragged on x loses the card's x on main too,
  // unlike Motion: a separate issue, not the claim's).
  const mountList = async (outer: Axis): Promise<{ readonly outer: () => HTMLElement; readonly item: () => HTMLElement }> => {
    let o: HTMLElement | undefined
    function List() {
      const [values, setValues] = createSignal(["a", "b", "c"])
      return (
        <Reorder.Group axis="y" values={values()} onReorder={setValues} style={{ "list-style": "none", margin: "0", padding: "30px 0 0 30px" }}>
          <For each={values()}>
            {(v) => (
              <Reorder.Item
                value={v}
                id={`nc-item-${v}`}
                dragMomentum={false}
                whileDrag={{ opacity: 0.5 }}
                whileHover={{ "background-color": HOVER.inner }}
                whileTap={{ color: TAP }}
                transition={T}
                style={{ width: "90px", height: "50px", "margin-bottom": "10px", background: BASE.inner, color: "rgb(0, 0, 0)" }}
              >
                {v}
              </Reorder.Item>
            )}
          </For>
        </Reorder.Group>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", left: "60px", top: "80px" }}>
          <wardic.div
            ref={(el: HTMLElement) => (o = el)}
            {...motionProps({ drag: outer }, "outer")}
            style={{ position: "relative", width: "240px", height: "180px", background: BASE.outer, color: "rgb(0, 0, 0)" }}
          >
            <List />
          </wardic.div>
        </div>
      </WardicProvider>
    ))
    await settle()
    await wait(100)
    return { outer: () => o!, item: () => document.getElementById("nc-item-a")! }
  }

  it("NC10.1: a y list in a free card: the item claims y, and the card, needing both axes, stays", async () => {
    const l = await mountList(true)
    const s: Scene = { outer: l.outer, inner: l.item, dropInner: () => undefined }
    const g = await gesture(s, centreOf(l.item()))
    expect(g.held).toEqual({ outer: "0,0 HT", inner: "0,30 DHT" })
  })

  it("NC10.2: a y list in an x card: the item claims y and the card x, so both drag", async () => {
    const l = await mountList("x")
    const s: Scene = { outer: l.outer, inner: l.item, dropInner: () => undefined }
    const g = await gesture(s, centreOf(l.item()))
    expect(g.held).toEqual({ outer: "60,0 DHT", inner: "60,30 DHT" })
  })
})
