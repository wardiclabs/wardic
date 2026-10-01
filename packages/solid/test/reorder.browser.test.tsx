// `Reorder.Group` / `Reorder.Item` (ADR-0020), driven with real Playwright mouse input.
//
// The cases and their orders are the evidence runs' (.tmp/reorder/reorder-run.ts),
// where motion/react 13.4.6's `Reorder` and the D4 prototype of the Crossover gave the
// same orders except in an rtl or reversed single-axis list: there Motion 13.1+ picks
// the neighbour by index, so it walks the wrong way or never reorders (13.0.0 sorted by
// position). Wardic's Crossover picks the neighbour on the side of the motion (D4).
//
// Motion's Reorder behaviour matched here: `ul` / `li` by default with `as`
// (Group.tsx, Item.tsx), `overflow-anchor: none` on the group under the user's style
// (Group.tsx:187-195), the axis detected from the items' boxes when none is given
// (detect-axis.ts), the dragged item raised while it's off its slot (Item.tsx's
// `zIndex`), and the release flying to the new slot. All at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8.
//
// "Under the pointer" is read after the pointer has held still for a few frames, so the
// known one-frame lag of a move (#32) doesn't enter it.
import type { ReorderAxis } from "@wardic/core"
import { createSignal, type JSX } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { until } from "./browser-helpers.ts"
import {
  add,
  centreOf,
  glide,
  grabOffsetOf,
  mouse,
  mountReorder,
  offPointer,
  type Pt,
  resetScene,
  sampleFrames,
  type Scene,
  settle,
  wait,
} from "./reorder-harness.tsx"

afterEach(resetScene)

// The evidence runs' rows are 440 px wide at left 40: an rtl or reversed row's first
// value is its rightmost box, past the test iframe's default 414 px. Widen it.
let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

/** Press on `value`'s centre, glide by (dx, dy) in `steps`, hold `holdMs`, and return the grab. */
const drag = async (
  s: Scene,
  value: string,
  dx: number,
  dy: number,
  steps: number,
  options: { readonly ms?: number; readonly holdMs?: number; readonly release?: boolean } = {},
): Promise<{ readonly g: Pt; readonly to: Pt; readonly grabOffset: Pt }> => {
  const el = s.item(value)
  const g = centreOf(el)
  const grabOffset = grabOffsetOf(el, g)
  const to = add(g, dx, dy)
  await mouse.down(g)
  await glide(g, to, steps, options.ms ?? 20)
  await wait(options.holdMs ?? 300)
  if (options.release === true) await mouse.up(to)
  return { g, to, grabOffset }
}

const joined = (orders: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> => orders.map((o) => o.join(""))

/** The attributes a motion prop would leave if it leaked through to the DOM. */
const MOTION_ATTRIBUTES = ["values", "onreorder", "axis", "value", "as", "layout", "layoutid", "drag", "whiledrag", "initial", "animate", "transition"]

describe("Reorder.Group and Reorder.Item", () => {
  it("RO1: a `ul` of `li`s by default, other tags with `as`, and no motion prop reaches the DOM", async () => {
    const s = await mountReorder({ whileDrag: { scale: 1.05 } })
    expect(s.group().tagName).toBe("UL")
    expect(s.item("a").tagName).toBe("LI")
    for (const el of [s.group(), s.item("a")]) {
      const names = el.getAttributeNames()
      for (const name of MOTION_ATTRIBUTES) expect(names, `${el.tagName} has no ${name}`).not.toContain(name)
    }
    await resetScene()
    const t = await mountReorder({ groupAs: "section", itemAs: "article" })
    expect(t.group().tagName).toBe("SECTION")
    expect(t.item("a").tagName).toBe("ARTICLE")
  })

  it("RO2: a slow drag of b past c calls onReorder once with the swapped values; the DOM follows; b stays under the pointer", async () => {
    const s = await mountReorder()
    const { to, grabOffset } = await drag(s, "b", 0, 46, 23, { holdMs: 400 })
    expect(joined(s.reorders)).toEqual(["acbde"])
    expect([...s.group().querySelectorAll<HTMLElement>("[data-value]")].map((el) => el.dataset.value).join("")).toBe("acbde")
    expect(offPointer(s.item("b"), to, grabOffset)).toBeLessThan(1)
  })

  it("RO3: a slow drag of a past three neighbours reorders three times, in order", async () => {
    const s = await mountReorder()
    await drag(s, "a", 0, 201, 67)
    expect(joined(s.reorders)).toEqual(["bacde", "bcade", "bcdae"])
  })

  it("RO4: moves about 50 ms apart still reorder (a 30 ms velocity window would read 0)", async () => {
    const s = await mountReorder()
    await drag(s, "b", 0, 46, 12, { ms: 50 })
    expect(joined(s.reorders)).toEqual(["acbde"])
  })

  it("RO5: a flick of a across the list, released while moving, ends in the right order", async () => {
    const s = await mountReorder()
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 12), 4, 0)
    await glide(add(g, 0, 12), add(g, 0, 252), 8, 0)
    await mouse.up(add(g, 0, 252))
    await wait(1200)
    expect(s.order().join("")).toBe("bcdea")
  })

  it("RO6: a displaced sibling moves on its first painted frame after the reorder and ends on its slot", async () => {
    const s = await mountReorder()
    const c = s.item("c")
    const before = c.getBoundingClientRect().top
    const sampling = sampleFrames(() => c.getBoundingClientRect().top)
    await drag(s, "b", 0, 46, 23, { holdMs: 700 })
    const frames = sampling.stop()
    expect(joined(s.reorders)).toEqual(["acbde"])
    const slot = before - 60
    const after = frames.filter((f) => f.frameAt > s.reorderTimes[0]!)
    const first = after[0]!.v
    expect(Math.abs(first - slot), "no jump to the new slot").toBeGreaterThan(1)
    expect(before - first, "moved toward it on the first frame").toBeGreaterThan(0.05)
    expect(Math.abs(after.at(-1)!.v - slot), "ends on the slot").toBeLessThanOrEqual(0.5)
  })

  it("RO7: axis x: a row reorders a past b and c", async () => {
    const s = await mountReorder({ layout: "x", axis: () => "x" })
    const { to, grabOffset } = await drag(s, "a", 201, 0, 67)
    expect(joined(s.reorders)).toEqual(["bacde", "bcade"])
    expect(offPointer(s.item("a"), to, grabOffset)).toBeLessThan(1)
  })

  it("RO8: axis xy: dragging a into the next row of a grid moves it onto that row (moveToLine)", async () => {
    const s = await mountReorder({ layout: "xy", axis: () => "xy" })
    await drag(s, "a", 90, 60, 40)
    expect(s.order().join("")).toBe("bcdeaf")
  })

  it("RO9: with no axis, a row is detected as x and a wrapped grid as xy", async () => {
    const row = await mountReorder({ layout: "x" })
    const a = row.item("a")
    const top = a.getBoundingClientRect().top
    await drag(row, "a", 201, 30, 67)
    expect(joined(row.reorders)).toEqual(["bacde", "bcade"])
    expect(Math.abs(a.getBoundingClientRect().top - top), "x only: no y movement").toBeLessThan(0.5)
    await resetScene()
    const grid = await mountReorder({ layout: "xy" })
    await drag(grid, "a", 90, 60, 40)
    expect(grid.order().join("")).toBe("bcdeaf")
  })

  it("RO10: a reactive axis changed between gestures applies to the next gesture", async () => {
    const [axis, setAxis] = createSignal<ReorderAxis>("y")
    const s = await mountReorder({ axis })
    const b = s.item("b")
    const left = b.getBoundingClientRect().left
    const first = await drag(s, "b", 40, 20, 10)
    expect(Math.abs(b.getBoundingClientRect().left - left), "y: no x movement").toBeLessThan(0.5)
    await mouse.up(first.to)
    await wait(900)
    setAxis("xy")
    await settle()
    const second = await drag(s, "b", 40, 20, 10)
    expect(offPointer(b, second.to, second.grabOffset), "xy: follows on both axes").toBeLessThan(1)
  })

  it("RO11: rtl row (detected x): toward the left neighbour reorders; 30 px the other way doesn't walk to the far end", async () => {
    const toward = await mountReorder({ layout: "x", rtl: true })
    await drag(toward, "a", -201, 0, 67)
    expect(joined(toward.reorders)).toEqual(["bacde", "bcade"])
    await resetScene()
    const away = await mountReorder({ layout: "x", rtl: true })
    await drag(away, "b", 30, 0, 15)
    expect(joined(away.reorders), "motion/react 13.4.6: acbde, acdbe, acdeb").toEqual([])
  })

  it("RO12: row-reverse and column-reverse reorder toward the neighbour on the moving side", async () => {
    const row = await mountReorder({ layout: "x", reverse: true })
    await drag(row, "a", -201, 0, 67)
    expect(joined(row.reorders), "motion/react 13.4.6: none").toEqual(["bacde", "bcade"])
    await resetScene()
    const column = await mountReorder({ layout: "y", reverse: true })
    await drag(column, "a", 0, -130, 44)
    expect(joined(column.reorders), "motion/react 13.4.6: none").toEqual(["bacde", "bcade"])
  })

  it("RO13: the dragged item paints above its siblings on every frame of a retarget, and its z-index goes after the release", async () => {
    const s = await mountReorder()
    const b = s.item("b")
    const g = centreOf(b)
    let pointer = g
    const sampling = sampleFrames(() => {
      const hit = document.elementFromPoint(pointer.x, pointer.y)
      return hit !== null && (hit === b || b.contains(hit))
    })
    await mouse.down(g)
    for (const [from, to, steps] of [
      [0, 45, 15],
      [45, 9, 12],
      [9, 45, 12],
    ] as const) {
      for (let k = 1; k <= steps; k++) {
        pointer = add(g, 0, from + ((to - from) * k) / steps)
        await mouse.move(pointer)
      }
    }
    await wait(400)
    const frames = sampling.stop()
    expect(joined(s.reorders)).toEqual(["acbde", "abcde", "acbde"])
    const under = frames.filter((f) => !f.v).length
    expect(under, `frames with b under a sibling, of ${frames.length} (was 16-23%)`).toBe(0)
    await mouse.up(pointer)
    await wait(900)
    expect(b.style.getPropertyValue("z-index"), "no inline z-index at rest").toBe("")
    // Nothing inline is left over a stylesheet's z-index (not even `auto`).
    const sheet = document.createElement("style")
    sheet.textContent = "[data-value] { z-index: 3; }"
    document.head.append(sheet)
    try {
      expect(getComputedStyle(b).zIndex).toBe("3")
    } finally {
      sheet.remove()
    }
  })

  it("RO14: the release flies b to its new slot and ends on it", async () => {
    const s = await mountReorder()
    const b = s.item("b")
    const groupTop = s.group().getBoundingClientRect().top
    const { to } = await drag(s, "b", 0, 46, 23)
    const sampling = sampleFrames(() => b.getBoundingClientRect().top)
    const upAt = performance.now()
    await mouse.up(to)
    await wait(900)
    const frames = sampling.stop().filter((f) => f.frameAt > upAt)
    const slot = groupTop + 2 * 60
    expect(Math.abs(frames[0]!.v - slot), "flies (not a jump)").toBeGreaterThan(1)
    expect(Math.abs(frames.at(-1)!.v - slot), "ends on the slot").toBeLessThanOrEqual(0.5)
  })

  it("RO15: an item's touch-action follows the group's axis, and follows a re-layout after a reorder", async () => {
    const y = await mountReorder()
    expect(y.item("a").style.getPropertyValue("touch-action")).toBe("pan-x")
    await resetScene()
    const x = await mountReorder({ layout: "x" })
    expect(x.item("a").style.getPropertyValue("touch-action")).toBe("pan-y")
    await resetScene()
    const xy = await mountReorder({ layout: "xy" })
    expect(xy.item("a").style.getPropertyValue("touch-action")).toBe("none")
    await resetScene()
    const [css, setCss] = createSignal<JSX.CSSProperties>({})
    const s = await mountReorder({ groupStyle: css })
    expect(s.item("a").style.getPropertyValue("touch-action")).toBe("pan-x")
    setCss({ "flex-direction": "row", width: "auto" })
    s.setOrder(["b", "a", "c", "d", "e"])
    await until(() => s.item("a").style.getPropertyValue("touch-action") === "pan-y", 1000)
    expect(s.item("a").style.getPropertyValue("touch-action")).toBe("pan-y")
  })

  it("RO16: the group's inline overflow-anchor is none, and the user's style wins", async () => {
    const s = await mountReorder()
    expect(s.group().style.getPropertyValue("overflow-anchor")).toBe("none")
    await resetScene()
    const t = await mountReorder({ groupStyle: () => ({ "overflow-anchor": "auto" }) })
    expect(t.group().style.getPropertyValue("overflow-anchor")).toBe("auto")
  })

  it("RO17: an item's ordinary props still work: whileDrag scales it while held", async () => {
    const s = await mountReorder({ whileDrag: { scale: 1.1 } })
    const b = s.item("b")
    await drag(s, "b", 0, 10, 5)
    await until(() => b.getBoundingClientRect().width > 219)
    expect(b.getBoundingClientRect().width).toBeCloseTo(220, 0)
  })

  it("RO18: the gesture's axis: in a y list a diagonal drag moves the item only on y", async () => {
    const s = await mountReorder()
    const b = s.item("b")
    const start = b.getBoundingClientRect()
    await drag(s, "b", 40, 20, 10)
    const now = b.getBoundingClientRect()
    expect(Math.abs(now.left - start.left), "x").toBeLessThan(0.5)
    expect(now.top - start.top, "y").toBeCloseTo(20, 0)
  })
})
