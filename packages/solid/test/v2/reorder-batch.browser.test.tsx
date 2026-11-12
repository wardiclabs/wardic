// `Reorder.BatchGroup` and `Reorder.BatchItem` on Solid 2 (#712, ADR-0072): Solid 1's tests
// (`reorder-batch.browser.test.tsx`), the reference Solid 2's `Reorder.Group` on the same geometry
// (`reorder-scene.tsx`), driven with real Playwright mouse and key input.
//
// - BG1: the group lays its items out at their places, a column, a row or a grid, and is sized to them.
// - BG2: a real mouse's drags reorder as they reorder a `Reorder.Group`, the same paths giving the same
//   orders; the DOM follows; the item in hand stays under the pointer.
// - BG3: the keyboard reorder is `Reorder.Group`'s: the same keys give the same values and announcements;
//   focus stays; a lift raises the item; each item is a tab stop reading the instructions; in a scroller,
//   End reveals the item's place.
// - BG4: the item in hand: `whileDrag` through a drag and a keyboard lift; raised in hand, then let down
//   once it lands, or at once when nothing moves; let go while flung, it carries on along the fling before
//   it turns back.
// - BG5: no item listens at rest, and the page's listeners are as many for 10 items as for 5.
// - BG7: a drag held near its scroller's edge scrolls it, the item moving down the list under the pointer.
// - BG10: held past its scroller's edge while Auto-scroll runs faster than a place a drag update, brought back
//   and let go, the item's place keeps up with it and it lands where it's let go.
// - BG8: a grab stops an item flying back from a release; a press with no drag lets it go on.
// - BG9: a function `whileDrag`'s keys join the group's.
// - BP1 (#712's PR 3): `whileHover` and `whileTap` by the pointer; Space lifts while the keyboard reorder is
//   on and presses while it's off, from the next key once it's switched (Q32).
// - BP2: a drag takes over a press; a function `whileTap`'s keys join the group's (Q34).
// - BE1: a leaver under `<AnimatePresence>` plays its exit at its last place, inert; the others close up at
//   once, and the group shrinks at once (Q38).
// - BR1 (Q35): right-to-left places, drags and keys are an rtl `Reorder.Group`'s; a page's `dir` does it with
//   no prop, at once.
// - BC1 (Q36): a grid's columns from its width, at once as it mounts; widened, more a row.
// - BR2 (Q35): `direction` taken away after it mounts: the places the inherited direction gives.
// - BE2 (Q38): an item that leaves while it's dragged exits at its last place, let go, whileDrag off.
// - BG6: `groupRef`'s group (Q25): its `next`, `when` and `each` of `holdStart`, `reorderEnd` and `holdEnd`,
//   as `reorderGroup()`'s, its `axis`, and `move`, announced.
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import { createSignal, flush } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import "../browser-commands.ts"
import { raf } from "../browser-helpers.ts"
import { type BatchScene, type BatchSceneOptions, mountBatchReorder, resetBatchScene } from "./reorder-batch-scene.tsx"
import { add, centreOf, glide, grabOffsetOf, type Layout, mountReorder, mouse, offPointer, type Pt, sampleFrames, wait } from "./reorder-scene.tsx"

afterEach(resetBatchScene)

// The rows reach past the test iframe's default 414 px: widen it, as the Reorder tests do.
let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

/** What both scenes give a test: their order, their items and their group. */
type Scene = Pick<BatchScene, "order" | "reorders" | "item" | "group">

/** `el`'s box on the page, rounded. */
const boxOf = (el: Element): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } => {
  const b = el.getBoundingClientRect()
  return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }
}

/** `el`'s drawn scale, from its transform. */
const scaleOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).a

/** `count` frames. */
const frames = async (count: number): Promise<void> => {
  for (let f = 0; f < count; f++) await raf()
}

/** Press on `value`'s centre, glide by (dx, dy) in `steps`, hold `holdMs`, and return the grab. */
const drag = async (s: Scene, value: string, dx: number, dy: number, steps: number, holdMs = 300): Promise<{ readonly to: Pt; readonly grabOffset: Pt }> => {
  const el = s.item(value)
  const g = centreOf(el)
  const grabOffset = grabOffsetOf(el, g)
  const to = add(g, dx, dy)
  await mouse.down(g)
  await glide(g, to, steps, 20)
  await wait(holdMs)
  return { to, grabOffset }
}

const joined = (orders: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> => orders.map((o) => o.join(""))

/** The values in DOM order, under `group`. */
const domOrder = (group: Element): string => [...group.querySelectorAll<HTMLElement>("[data-value]")].map((el) => el.dataset.value).join("")

/** A drag's path: the item, and how far and in how many moves. */
interface Path {
  readonly value: string
  readonly dx: number
  readonly dy: number
  readonly steps: number
}

/** `path` driven on a `Reorder.Group` with `layout`'s geometry, then on a `Reorder.BatchGroup` with it. */
const both = async (layout: Layout, path: Path, options: BatchSceneOptions = {}, reference: { readonly rtl?: boolean } = {}) => {
  const run = async (s: Scene) => {
    const { to, grabOffset } = await drag(s, path.value, path.dx, path.dy, path.steps)
    const result = { reorders: joined(s.reorders), dom: domOrder(s.group()), off: offPointer(s.item(path.value), to, grabOffset) }
    await mouse.up(to)
    await resetBatchScene()
    return result
  }
  const referenced = await run(await mountReorder({ ...reference, layout, axis: () => layout }))
  const batch = await run(await mountBatchReorder({ ...options, layout }))
  return { reference: referenced, batch }
}

/** Every text the page's live region shows from now on, in order. */
const recordAnnouncements = (): { readonly texts: Array<string>; readonly stop: () => void } => {
  const region = document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)
  const texts: Array<string> = []
  const observer = new MutationObserver(() => texts.push((region?.textContent ?? "").replace(/ $/, "")))
  if (region !== null) observer.observe(region, { childList: true, characterData: true, subtree: true })
  return { texts, stop: () => observer.disconnect() }
}

/** Keys pressed on `value`'s item, focused: the values after each, what was said, and where focus ended. */
const keys = async (s: Scene, value: string, pressed: ReadonlyArray<string>) => {
  const el = s.item(value)
  el.focus()
  const said = recordAnnouncements()
  const orders: Array<string> = []
  const raises: Array<string> = []
  for (const key of pressed) {
    await commands.realKey("press", key)
    await frames(3)
    orders.push(s.order().join(""))
    raises.push(getComputedStyle(el).zIndex)
  }
  said.stop()
  return { orders, said: said.texts.filter((text) => text !== ""), focused: document.activeElement === el, raises, dom: domOrder(s.group()) }
}

describe("Reorder.BatchGroup and Reorder.BatchItem on Solid 2", () => {
  it("BG1: the group lays its items out at their places, a column, a row or a grid, and is sized to them", async () => {
    const column = await mountBatchReorder({ layout: "y" })
    expect(boxOf(column.group()), "the column's group").toEqual({ left: 40, top: 40, width: 200, height: 5 * 50 + 4 * 10 })
    expect(["a", "b", "c", "d", "e"].map((v) => boxOf(column.item(v))), "the column's items").toEqual(
      [0, 1, 2, 3, 4].map((i) => ({ left: 40, top: 40 + i * 60, width: 200, height: 50 })),
    )
    expect(domOrder(column.group()), "the DOM in the list's order").toBe("abcde")
    await resetBatchScene()
    const row = await mountBatchReorder({ layout: "x" })
    expect(boxOf(row.group()), "the row's group").toEqual({ left: 40, top: 40, width: 5 * 80 + 4 * 10, height: 50 })
    expect(boxOf(row.item("c")), "the row's third").toEqual({ left: 40 + 2 * 90, top: 40, width: 80, height: 50 })
    await resetBatchScene()
    const grid = await mountBatchReorder({ layout: "xy" })
    expect(boxOf(grid.group()), "the grid's group").toEqual({ left: 40, top: 40, width: 3 * 80 + 2 * 10, height: 2 * 50 + 10 })
    expect(boxOf(grid.item("e")), "the grid's fifth: row 2, column 2").toEqual({ left: 40 + 90, top: 40 + 60, width: 80, height: 50 })
  })

  it("BG2: a real mouse's drags reorder as a Reorder.Group's on the same geometry; the DOM follows; the item stays under the pointer", async () => {
    const paths: ReadonlyArray<readonly [Layout, Path]> = [
      ["y", { value: "b", dx: 0, dy: 46, steps: 23 }],
      ["y", { value: "a", dx: 0, dy: 201, steps: 67 }],
      ["y", { value: "e", dx: 0, dy: -150, steps: 50 }],
      ["x", { value: "a", dx: 201, dy: 0, steps: 67 }],
      ["xy", { value: "a", dx: 90, dy: 60, steps: 40 }],
    ]
    for (const [layout, path] of paths) {
      const { reference, batch } = await both(layout, path)
      const name = `${layout}: ${path.value} by (${path.dx}, ${path.dy})`
      expect(reference.reorders.length, `${name}: the reference reorders`).toBeGreaterThan(0)
      expect(batch.reorders, `${name}: the same orders`).toEqual(reference.reorders)
      expect(batch.dom, `${name}: the DOM follows`).toBe(reference.reorders.at(-1))
      expect(batch.off, `${name}: under the pointer`).toBeLessThan(1)
    }
  }, 60_000)

  it("BG3: the keyboard reorder is Reorder.Group's: values, announcements, focus, the raise, the tab stop", async () => {
    const sequences: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ["b", ["Space", "ArrowDown", "ArrowDown", "Space"]],
      ["d", ["Enter", "ArrowUp", "Home", "Escape"]],
      ["a", ["Space", "End", "Enter"]],
    ]
    for (const [value, pressed] of sequences) {
      const reference = await keys(await mountReorder({ layout: "y", axis: () => "y" }), value, pressed)
      await resetBatchScene()
      const batch = await keys(await mountBatchReorder({ layout: "y" }), value, pressed)
      await resetBatchScene()
      const name = `${value}: ${pressed.join(" ")}`
      expect(reference.said.length, `${name}: the reference speaks`).toBeGreaterThan(0)
      expect(batch.orders, `${name}: the same values`).toEqual(reference.orders)
      expect(batch.said, `${name}: the same announcements`).toEqual(reference.said)
      expect(batch.focused, `${name}: focus stays`).toBe(true)
      expect(batch.raises[0], `${name}: raised as it's lifted`).toBe("2")
      expect(batch.dom, `${name}: the DOM follows`).toBe(batch.orders.at(-1))
    }
    const s = await mountBatchReorder({ layout: "y" })
    const b = s.item("b")
    expect(b.getAttribute("tabindex"), "a tab stop").toBe("0")
    expect(document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent, "the instructions").toBe(ReorderController.DEFAULT_INSTRUCTIONS)
    await resetBatchScene()
    // In a scroller 120 px tall: End steps a to the last place, below it, and the place is revealed.
    const scrolled = await mountBatchReorder({ layout: "y", n: 10, container: 120 })
    const scroller = scrolled.scroller as HTMLElement
    await keys(scrolled, "a", ["Space", "End"])
    await frames(4)
    expect(scrolled.order().at(-1), "stepped to the end").toBe("a")
    expect(scroller.scrollTop, "its place in view").toBe(9 * 60 + 50 - 120)
  }, 60_000)

  it("BG4: the item in hand: whileDrag through a drag and a lift, the raise, and a fling's speed carried on", async () => {
    const fast = { type: "spring", stiffness: 400, damping: 40 } as const
    const s = await mountBatchReorder({ layout: "y", whileDrag: { scale: 1.1 }, transition: fast })
    const b = s.item("b")
    const g = centreOf(b)
    await mouse.down(g)
    await glide(g, add(g, 0, 20), 5, 20)
    await wait(400)
    expect(scaleOf(b), "whileDrag while dragged").toBeCloseTo(1.1, 2)
    expect(getComputedStyle(b).zIndex, "raised in hand").toBe("2")
    await mouse.up(add(g, 0, 20))
    await frames(1)
    expect(getComputedStyle(b).zIndex, "coming to rest").toBe("1")
    await wait(800)
    expect(scaleOf(b), "whileDrag off").toBeCloseTo(1, 3)
    expect(getComputedStyle(b).zIndex, "let down once it lands").toBe("auto")
    expect(Math.round(b.getBoundingClientRect().top), "back at its place").toBe(40 + 60)

    b.focus()
    await commands.realKey("press", "Space")
    await wait(400)
    expect(scaleOf(b), "whileDrag while lifted").toBeCloseTo(1.1, 2)
    expect(getComputedStyle(b).zIndex, "raised while lifted").toBe("2")
    await commands.realKey("press", "Space")
    await wait(800)
    expect(scaleOf(b), "whileDrag off at the drop").toBeCloseTo(1, 3)
    expect(getComputedStyle(b).zIndex, "let down once it lands").toBe("auto")
    await resetBatchScene()

    const plain = await mountBatchReorder({ layout: "y" })
    const c = plain.item("c")
    c.focus()
    await commands.realKey("press", "Space")
    await frames(2)
    expect(getComputedStyle(c).zIndex, "raised while lifted").toBe("2")
    await commands.realKey("press", "Space")
    await frames(2)
    expect(getComputedStyle(c).zIndex, "let down at once, nothing moving").toBe("auto")
    await resetBatchScene()

    const t = await mountBatchReorder({ layout: "y", transition: { type: "spring", stiffness: 40, damping: 6 } })
    const a = t.item("a")
    const ga = centreOf(a)
    await mouse.down(ga)
    await glide(ga, add(ga, 0, 6), 3, 20)
    for (let k = 1; k <= 3; k++) {
      await mouse.move(add(ga, 0, 6 + 6 * k))
      await wait(30)
    }
    const tops = sampleFrames(() => a.getBoundingClientRect().top)
    await mouse.up(add(ga, 0, 30))
    const releasedAt = performance.now()
    await wait(300)
    const after = tops.stop().filter((frame) => frame.frameAt > releasedAt).map((frame) => frame.v)
    expect(t.order().join(""), "no reorder").toBe("abcde")
    // A soft spring, so a slow runner's lower release speed still carries it on a few px; let go at none, it
    // never passes where it was let go (40 + 30).
    expect(Math.max(...after.slice(0, 6)), "carried on down past where it was let go").toBeGreaterThan(40 + 30 + 0.5)
    await wait(2500)
    expect(Math.round(a.getBoundingClientRect().top), "then back at its place").toBe(40)
  }, 30_000)

  it("BG5: no item listens at rest, as many listeners for 10 items as for 5; a focus and a blur leave none behind", async () => {
    const live = new Map<EventTarget, number>()
    const realAdd = EventTarget.prototype.addEventListener
    const realRemove = EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<typeof realAdd>) {
      live.set(this, (live.get(this) ?? 0) + 1)
      return realAdd.apply(this, args)
    }
    EventTarget.prototype.removeEventListener = function (this: EventTarget, ...args: Parameters<typeof realRemove>) {
      live.set(this, (live.get(this) ?? 0) - 1)
      return realRemove.apply(this, args)
    }
    const total = (): number => [...live.values()].reduce((sum, n) => sum + n, 0)
    const onItems = (s: Scene): number => [...s.group().children].reduce((sum, el) => sum + (live.get(el) ?? 0), 0)
    try {
      const before = total()
      const five = await mountBatchReorder({ layout: "y", n: 5 })
      const forFive = total() - before
      expect(onItems(five), "no item listens at rest").toBe(0)
      await resetBatchScene()
      const afterFive = total()
      const ten = await mountBatchReorder({ layout: "y", n: 10 })
      expect(total() - afterFive, "as many listeners for 10 items as for 5").toBe(forFive)
      expect(onItems(ten), "no item listens at rest").toBe(0)
      const atRest = total()
      const b = ten.item("b")
      b.focus()
      await frames(1)
      b.blur()
      await frames(2)
      expect(total(), "a focus and a blur leave none behind").toBe(atRest)
    } finally {
      EventTarget.prototype.addEventListener = realAdd
      EventTarget.prototype.removeEventListener = realRemove
    }
  })

  it("BG6: groupRef's group: its events, as reorderGroup()'s, its axis, and move, announced", async () => {
    const s = await mountBatchReorder({ layout: "y" })
    const list = s.list()
    expect(list.axis(), "its axis").toBe("y")
    const told: Array<string> = []
    const started = list.next("holdStart").then((start) => told.push(`start ${start.value} ${start.from}`))
    const reordered = list.next("reorderEnd").then((end) => told.push(`reorder ${end.value} ${end.from}→${end.to}`))
    const ended = list.next("holdEnd").then((end) => told.push(`end ${end.value} ${end.from}→${end.to} ${end.how}`))
    const { to } = await drag(s, "b", 0, 46, 23)
    await mouse.up(to)
    await Promise.all([started, reordered, ended])
    expect(told).toEqual(["start b 1", "reorder b 1→2", "end b 1→2 drop"])
    const said = recordAnnouncements()
    list.move("a", 4)
    await frames(3)
    said.stop()
    expect(s.order().join(""), "moved in code").toBe("cbdea")
    expect(domOrder(s.group()), "the DOM follows").toBe("cbdea")
    expect(said.texts.filter((text) => text !== "").at(-1), "announced").toMatch(/a.*5 of 5/)
  }, 30_000)

  it("BG7: a drag held near its scroller's bottom edge scrolls it, the item moving down the list under the pointer", async () => {
    // Ten values, in a scroller 200 px tall: a 390 px range, which the glide alone nearly crosses.
    const s = await mountBatchReorder({ layout: "y", n: 10, container: 200 })
    const sc = s.scroller as HTMLElement
    const max = sc.scrollHeight - sc.clientHeight
    const c = s.item("c")
    const g = centreOf(c)
    const grabOffset = grabOffsetOf(c, g)
    const edge = sc.getBoundingClientRect().bottom
    await mouse.down(g)
    const to = { x: g.x, y: edge - 15 }
    await glide(g, to, 20)
    await wait(800)
    expect(sc.scrollTop, "scrolled to its end").toBeCloseTo(max, 0)
    await frames(4)
    expect(s.order().indexOf("c"), "c moved down the list").toBeGreaterThan(4)
    expect(offPointer(c, to, grabOffset), "the item under the pointer").toBeLessThan(2)
    expect(domOrder(s.group()), "the DOM follows").toBe(s.order().join(""))
  }, 30_000)

  it("BG10: held past its scroller's edge while Auto-scroll runs, then brought back and let go, the item lands where it's let go", async () => {
    // 400 values 60 px apart in a scroller 200 px tall. Held 60 px past its edge, Auto-scroll scrolls 25 × 2.2²
    // = 121 px a drag update, two places each: the Crossover has to keep up with the item, not trail it a place
    // a sample, or its release sends it back up the list to where the order had fallen behind.
    const s = await mountBatchReorder({ layout: "y", values: Array.from({ length: 400 }, (_, i) => `v${i}`), container: 200 })
    const sc = s.scroller as HTMLElement
    const v2 = s.item("v2")
    const g = centreOf(v2)
    const grabOffset = grabOffsetOf(v2, g)
    const view = sc.getBoundingClientRect()
    await mouse.down(g)
    const outside = { x: g.x, y: view.bottom + 60 }
    await glide(g, outside, 20)
    await wait(500)
    expect(sc.scrollTop, "Auto-scroll ran").toBeGreaterThan(2000)
    const inside = { x: g.x, y: view.top + view.height / 2 }
    await glide(outside, inside, 20)
    await wait(200)
    // The place it's held over: its top in the group, to the nearest place.
    const heldOver = Math.round((v2.getBoundingClientRect().top - s.group().getBoundingClientRect().top) / 60)
    expect(s.order().indexOf("v2"), "its place in the order is the one it's held over").toBe(heldOver)
    await mouse.up(inside)
    await wait(800)
    expect(offPointer(v2, inside, grabOffset), "it lands under the pointer, within half a place").toBeLessThan(31)
  }, 30_000)

  it("BG8: a grab stops an item flying back from a release; a press with no drag lets it go on", async () => {
    const s = await mountBatchReorder({ layout: "y", transition: { type: "spring", stiffness: 60, damping: 12 } })
    const a = s.item("a")
    const g = centreOf(a)
    await mouse.down(g)
    await glide(g, add(g, 0, 30), 10, 20)
    await wait(100)
    await mouse.up(add(g, 0, 30))
    await wait(60)
    const grabAt = centreOf(a)
    await mouse.down(grabAt)
    await frames(1)
    const stoppedAt = a.getBoundingClientRect().top
    await wait(250)
    expect(stoppedAt, "still off its place").toBeGreaterThan(40 + 2)
    expect(Math.abs(a.getBoundingClientRect().top - stoppedAt), "held where the grab stopped it").toBeLessThan(0.5)
    await mouse.up(grabAt)
    await wait(2000)
    expect(Math.round(a.getBoundingClientRect().top), "gone on to its place").toBe(40)
    expect(s.order().join(""), "no reorder").toBe("abcde")
  }, 30_000)

  it("BG9: a function whileDrag's keys join the group's, laid over an item dragged or lifted", async () => {
    const s = await mountBatchReorder({ layout: "y", whileDrag: (_, i) => ({ scale: 1.1 + i * 0 }), transition: { type: "spring", stiffness: 400, damping: 40 } })
    const b = s.item("b")
    const { to } = await drag(s, "b", 0, 46, 23, 400)
    expect(scaleOf(b), "laid over the dragged item").toBeCloseTo(1.1, 2)
    expect(s.order().join(""), "it reorders").toBe("acbde")
    await mouse.up(to)
    await wait(800)
    expect(scaleOf(b), "off at the drop").toBeCloseTo(1, 3)
    b.focus()
    await commands.realKey("press", "Space")
    await wait(400)
    expect(scaleOf(b), "laid over the lifted item").toBeCloseTo(1.1, 2)
    await commands.realKey("press", "Escape")
  }, 30_000)

  it("BP1: whileHover and whileTap by the pointer; Space lifts while the keyboard reorder is on, presses while it's off", async () => {
    const [keyboard, setKeyboard] = createSignal(true)
    const fast = { type: "spring", stiffness: 500, damping: 40 } as const
    const s = await mountBatchReorder({ layout: "y", keyboard, whileHover: { scale: 1.05 }, whileTap: { scale: 0.9 }, transition: fast })
    const b = s.item("b")
    const g = centreOf(b)
    await mouse.move(g)
    await wait(300)
    expect(scaleOf(b), "whileHover").toBeCloseTo(1.05, 2)
    await mouse.down(g)
    await wait(300)
    expect(scaleOf(b), "whileTap").toBeCloseTo(0.9, 2)
    await mouse.up(g)
    await wait(300)
    expect(scaleOf(b), "back to whileHover").toBeCloseTo(1.05, 2)
    await mouse.move({ x: 5, y: 5 })
    await wait(300)
    expect(scaleOf(b), "back to rest").toBeCloseTo(1, 3)

    const c = s.item("c")
    c.focus()
    await commands.realKey("down", "Space")
    await wait(300)
    expect(getComputedStyle(c).zIndex, "lifted").toBe("2")
    expect(scaleOf(c), "not pressed").toBeCloseTo(1, 3)
    await commands.realKey("up", "Space")
    await commands.realKey("press", "Space")
    await frames(2)
    setKeyboard(false)
    flush()
    await commands.realKey("down", "Space")
    await wait(300)
    expect(scaleOf(c), "pressed by Space").toBeCloseTo(0.9, 2)
    expect(getComputedStyle(c).zIndex, "not lifted").toBe("auto")
    await commands.realKey("up", "Space")
    await wait(300)
    expect(scaleOf(c), "the press ends").toBeCloseTo(1, 3)
    setKeyboard(true)
    flush()
    await commands.realKey("press", "Space")
    await wait(300)
    expect(getComputedStyle(c).zIndex, "lifted again").toBe("2")
    expect(scaleOf(c), "not pressed").toBeCloseTo(1, 3)
    await commands.realKey("press", "Escape")
  }, 30_000)

  it("BP2: a drag takes over a press: whileTap off as it starts, whileDrag on; a function whileTap's keys join", async () => {
    const fast = { type: "spring", stiffness: 500, damping: 40 } as const
    const s = await mountBatchReorder({ layout: "y", whileTap: (_, i) => ({ scale: 0.9, opacity: 0.8 + i * 0 }), whileDrag: { scale: 1.1 }, transition: fast })
    const b = s.item("b")
    const g = centreOf(b)
    await mouse.down(g)
    await wait(300)
    expect(scaleOf(b), "pressed").toBeCloseTo(0.9, 2)
    expect(Number(getComputedStyle(b).opacity), "the function's own key").toBeCloseTo(0.8, 2)
    await glide(g, add(g, 0, 20), 5, 20)
    await wait(300)
    expect(scaleOf(b), "dragged: whileDrag, not whileTap").toBeCloseTo(1.1, 2)
    await mouse.up(add(g, 0, 20))
    await wait(500)
    expect(scaleOf(b), "at rest").toBeCloseTo(1, 3)
  }, 30_000)

  it("BE1: a leaver plays its exit at its last place, inert; the others close up at once, the group shrinks at once", async () => {
    const s = await mountBatchReorder({ layout: "y", exit: { opacity: 0, transition: { type: "tween", duration: 0.6 } }, transition: { type: "tween", duration: 0.3 } })
    const b = s.item("b")
    s.setOrder(["a", "c", "d", "e"])
    await frames(2)
    expect(b.isConnected, "kept while it exits").toBe(true)
    expect(boxOf(b).top, "at its last place").toBe(40 + 60)
    expect(b.inert, "neither focusable nor draggable").toBe(true)
    expect(Number(getComputedStyle(b).opacity), "fading").toBeLessThan(1)
    expect(boxOf(s.group()).height, "the group shrinks at once").toBe(4 * 50 + 3 * 10)
    await wait(400)
    expect(boxOf(s.item("c")).top, "c closed up").toBe(40 + 60)
    await wait(500)
    expect(b.isConnected, "gone once it lands").toBe(false)
    expect(domOrder(s.group())).toBe("acde")
  }, 30_000)

  it("BR1: right-to-left places, drags and keys are an rtl Reorder.Group's; a page's dir does it with no prop, at once", async () => {
    const reference = await mountReorder({ layout: "x", axis: () => "x", rtl: true })
    const referenceBoxes = ["a", "b", "c", "d", "e"].map((v) => boxOf(reference.item(v)))
    await resetBatchScene()
    const row = await mountBatchReorder({ layout: "x", direction: "rtl" })
    expect(["a", "b", "c", "d", "e"].map((v) => boxOf(row.item(v))), "a row's places, mirrored").toEqual(referenceBoxes)
    await resetBatchScene()
    const inherited = await mountBatchReorder({ layout: "x", rtl: true })
    expect(["a", "b", "c", "d", "e"].map((v) => boxOf(inherited.item(v))), "a page's dir, at once").toEqual(referenceBoxes)
    await resetBatchScene()
    const grid = await mountBatchReorder({ layout: "xy", direction: "rtl" })
    const right = boxOf(grid.group()).left + boxOf(grid.group()).width
    expect(boxOf(grid.item("a")), "a grid's first place at its right edge").toEqual({ left: right - 80, top: 40, width: 80, height: 50 })
    expect(boxOf(grid.item("d")).left, "its second row from the right too").toBe(right - 80)
    await resetBatchScene()
    const paths: ReadonlyArray<Path> = [
      { value: "a", dx: -201, dy: 0, steps: 67 },
      { value: "b", dx: 30, dy: 0, steps: 15 },
    ]
    for (const path of paths) {
      const { reference: r, batch } = await both("x", path, { direction: "rtl" }, { rtl: true })
      expect(batch.reorders, `${path.value} by ${path.dx}: the same orders`).toEqual(r.reorders)
      expect(batch.off, `${path.value} by ${path.dx}: under the pointer`).toBeLessThan(1)
    }
    const gridPaths: ReadonlyArray<Path> = [
      { value: "a", dx: -90, dy: 60, steps: 40 },
      { value: "c", dx: 180, dy: 0, steps: 60 },
    ]
    for (const path of gridPaths) {
      const { reference: r, batch } = await both("xy", path, { direction: "rtl" }, { rtl: true })
      expect(r.reorders.length, `grid ${path.value}: the reference reorders`).toBeGreaterThan(0)
      expect(batch.reorders, `grid ${path.value} by (${path.dx}, ${path.dy}): the same orders`).toEqual(r.reorders)
    }
    const pressed = ["Space", "ArrowLeft", "ArrowLeft", "ArrowRight", "Space"]
    const byKeys = await keys(await mountReorder({ layout: "x", axis: () => "x", rtl: true }), "b", pressed)
    await resetBatchScene()
    const batchKeys = await keys(await mountBatchReorder({ layout: "x", direction: "rtl" }), "b", pressed)
    expect(batchKeys.orders, "the arrows' orders").toEqual(byKeys.orders)
    expect(batchKeys.said, "the arrows' announcements").toEqual(byKeys.said)
  }, 60_000)

  it("BC1: a grid's columns from its width, at once as it mounts; widened, more a row, its height following", async () => {
    const [width, setWidth] = createSignal(300)
    const s = await mountBatchReorder({ layout: "xy", n: 10, fromWidth: width, transition: { type: "tween", duration: 0.2 } })
    expect(boxOf(s.item("d")), "three a row, at once").toEqual({ left: 40, top: 40 + 60, width: 80, height: 50 })
    expect(boxOf(s.group()), "its width the app's, its height its four rows'").toEqual({ left: 40, top: 40, width: 300, height: 4 * 50 + 3 * 10 })
    setWidth(480)
    flush()
    await wait(500)
    expect(boxOf(s.item("d")), "d on the first row").toEqual({ left: 40 + 3 * 90, top: 40, width: 80, height: 50 })
    expect(boxOf(s.item("f")), "f on the second").toEqual({ left: 40, top: 40 + 60, width: 80, height: 50 })
    expect(boxOf(s.group()).height, "two rows").toBe(2 * 50 + 10)
  }, 30_000)

  it("BR2: direction taken away after it mounts: the items go to the places the inherited direction gives", async () => {
    const [direction, setDirection] = createSignal<"ltr" | "rtl" | undefined>("rtl")
    const s = await mountBatchReorder({ layout: "x", directionOf: direction, transition: { type: "tween", duration: 0.1 } })
    expect(boxOf(s.item("a")).left, "rtl: a at the right").toBe(40 + 360)
    setDirection(undefined)
    flush()
    await wait(400)
    expect(boxOf(s.item("a")).left, "the page's ltr: a at the left").toBe(40)
    expect(boxOf(s.item("e")).left).toBe(40 + 360)
  }, 30_000)

  it("BE2: an item that leaves while it's dragged plays its exit at its last place: let go, whileDrag off, let down", async () => {
    const fast = { type: "spring", stiffness: 500, damping: 40 } as const
    const s = await mountBatchReorder({ layout: "y", whileDrag: { scale: 1.1 }, exit: { opacity: 0, transition: { type: "tween", duration: 0.8 } }, transition: fast })
    const b = s.item("b")
    const g = centreOf(b)
    await mouse.down(g)
    await glide(g, add(g, 0, 20), 5, 20)
    await wait(300)
    expect(getComputedStyle(b).zIndex, "in hand").toBe("2")
    s.setOrder(["a", "c", "d", "e"])
    await wait(400)
    expect(b.isConnected, "kept while it exits").toBe(true)
    expect(boxOf(b).top, "at its last place, not where the pointer held it").toBe(40 + 60)
    expect(scaleOf(b), "whileDrag off").toBeCloseTo(1, 2)
    expect(getComputedStyle(b).zIndex, "let down").toBe("auto")
    await mouse.up(add(g, 0, 20))
  }, 30_000)
})
