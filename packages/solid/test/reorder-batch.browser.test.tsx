// `Reorder.BatchGroup` and `Reorder.BatchItem` on Solid 1 (#712, ADR-0072): a long list reordered as one
// keyed Batch, each item at the place its index gives, driven with real Playwright mouse input. The
// reference is a `Reorder.Group` of `Reorder.Item`s on the same geometry (`reorder-harness.tsx`).
//
// - BG1: the group lays its items out at their places, a column, a row or a grid, and is sized to them;
//   each item is sized from `itemSize`; the DOM is in the list's order.
// - BG2: a real mouse's drags reorder as they reorder a `Reorder.Group` on the same geometry, the same
//   paths giving the same orders, a column's, a row's and a grid's; the DOM follows the order; the item in
//   hand stays under the pointer, on its axis.
// - BG3: the keyboard reorder is `Reorder.Group`'s: the same keys (Space and Enter lift and drop, the
//   arrows step, Escape cancels) give the same values and announcements; focus stays on the item; a lift
//   raises it; each item is a tab stop reading the instructions. In a scroller, End reveals the item's place.
// - BG4: the item in hand: `whileDrag` on through a drag and a keyboard lift, off as it's let go; raised
//   (`z-index` 2) in hand, 1 as it comes to rest, none once it lands, or at once when nothing moves; let
//   go while flung, it carries on along the fling before it turns back to its place.
// - BG7: a drag held near its scroller's edge scrolls it (Auto-scroll), the item moving down the list and
//   staying under the pointer.
// - BG8: a grab of an item flying back from a release stops it where it is; a press that ends with no drag
//   lets it go on to its place.
// - BG9: a function `whileDrag`'s keys join the group's: it lays its values over an item dragged or lifted.
// - BP1 (#712's PR 3): `whileHover` over an item the pointer is on and `whileTap` while a pointer presses
//   it; with the keyboard reorder on, Space lifts it and doesn't press it; off, Space presses it; switched
//   back on, the next Space lifts again (Q32).
// - BP2: a drag takes over a press: `whileTap` off as the drag starts, `whileDrag` on; a function
//   `whileTap`'s keys join the group's (Q34).
// - BE1: an item leaving under `<AnimatePresence>` plays its `exit` at its last place, its element kept until
//   it lands and neither focusable nor draggable meanwhile; the others close up at once, and the group
//   shrinks at once (Q38).
// - BR1 (Q35): right-to-left: `direction="rtl"` mirrors a row's places as an rtl `Reorder.Group` lays its
//   items out, and a grid's from its right edge; a page's `dir="rtl"` does it with no prop, at once; the
//   same drags and keys give an rtl `Reorder.Group`'s orders and announcements.
// - BR2 (Q35): `direction` taken away after it mounts: the items go back to the places the direction their
//   element inherits gives, not one read while the prop set it.
// - BE2 (Q38): an item that leaves while it's dragged plays its exit at its last place: let go, its
//   `whileDrag` off, let down.
// - BC1 (Q36): a grid with no `columns` holds as many a row as its width does, placed there at once as it
//   mounts; widened, it holds more, its items moving to their new places, its height following.
// - BG5: no item listens at rest, and the page's listeners are as many for 20 items as for 5; a focus
//   and a blur leave none behind.
// - BG10 (Q47): an item with no style, tab stop or `aria-describedby` of its own has the group's, written as
//   it mounts and kept as the group's changes (its item size, its instructions, its keyboard reorder); one
//   with its own keeps them, over the group's. A grid of such items from its width is placed at once, and
//   widened, holds more a row.
// - BG11 (#706, Q20): an item's `initial` keys but `x` and `y` move to their identity as it enters, at its
//   place: a column fades and grows in; a function `initial` in a grid from its width too; and an item
//   added later enters so.
//
// Items of different sizes, a function's (#714, ADR-0072 *Amendment (#714)*), against a `Reorder.Group` of
// items of the same sizes laid out by the browser's flexbox:
// - BD1: each item at the place the browser's flexbox gives it, its own size, a column's, a row's and a
//   grid's rows wrapping at its width; the group sized as the flexbox's.
// - BD2: a real mouse's drags reorder as the `Reorder.Group`'s do on the same paths.
// - BD3: the function is tracked: a size it reads changed, the item takes it and those after it move, the
//   group following; a new order places each item from the sizes before it.
// - BD4: a column whose `width` is left out, an object's or a function's: each item as wide as the group's
//   content box, padding and border inside it; the group widened, they follow.
//   Its padding changed with its content box the same, read again: they keep to its content box.
// - BD5: an item added later is sized and placed after the others; a grid's rows wrap again as it narrows.
// - BD6: `itemSize` switched from one size to a function and back, its items with no style of their own and
//   with their own: each item takes the sizes it's given each time, border-box while it takes the group's width.
// - BD7: right to left, a row of items each their own width: the places and the drags of an rtl `Reorder.Group`
//   of the same sizes.
//
// Items whose sizes are read from the page, `itemSize` left out (#714, decisions 3 to 5), each sized by its own
// CSS; never a "ResizeObserver loop" error:
// - BM5: each item at the place the browser's flexbox gives a `Reorder.Group`'s of the same sizes, a column's,
//   a row's and a grid's; the group sized as the flexbox's.
// - BM6: a real mouse's drags reorder as the `Reorder.Group`'s do, right to left too.
// - BM7: an item's size changed: it's read, the items after it move on the group's transition, and the group
//   follows.
// - BM8: rows of text as wide as the group: stacked a gap apart as they mount; the group widened, they wrap
//   again, are read again and stacked again, the group as tall as them.
// - BM9: an item added later is read and placed after the others; one put in the middle, those after it make
//   room.
// - BM10: no flight as they mount: out of flow at their places at the first frame, as they are at rest.
// - BM11: a border-box group with padding and a border, its items read or one size: the group as large as its
//   places and its padding and border, its items inside them; read, no loop error as they go out of flow.
// - BM12: switched to sizes read from the page at runtime, from one size and from a function's, and back: no
//   flight from a guess, and no pile; each item sized by the page's stylesheet.
// - BM13: hidden under an ancestor and shown again: no flight from a pile, each item's last size kept.
// - BM14: a column emptied keeps its width the app's; filled again, its items take it.
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import { commands } from "vitest/browser"
import { raf, recordLoopErrors, unstacked } from "./browser-helpers.ts"
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { Reorder, type ReorderBatchSizing, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { createSignal, For } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { type BatchSceneOptions, mountBatchReorder } from "./reorder-batch-harness.tsx"
import { add, centreOf, glide, grabOffsetOf, type Layout, mountReorder, mouse, offPointer, type Pt, resetScene, sampleFrames, type Scene, type SceneOptions, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

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

/** `el`'s box on the page, rounded. */
const boxOf = (el: Element): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } => {
  const b = el.getBoundingClientRect()
  return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }
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

/**
 * `path` driven on a `Reorder.Group` with `layout`'s geometry, then on a `Reorder.BatchGroup` with it: each
 * one's reorders, its DOM's order, and how far its item in hand ended from under the pointer.
 */
const both = async (layout: Layout, path: Path, options: BatchSceneOptions = {}, reference: Pick<SceneOptions, "rtl" | "sizeOf"> = {}) => {
  const run = async (s: Scene) => {
    const { to, grabOffset } = await drag(s, path.value, path.dx, path.dy, path.steps)
    const result = { reorders: joined(s.reorders), dom: domOrder(s.group()), off: offPointer(s.item(path.value), to, grabOffset) }
    await mouse.up(to)
    await resetScene()
    return result
  }
  const referenced = await run(await mountReorder({ ...reference, layout, axis: () => layout }))
  const batch = await run(await mountBatchReorder({ ...options, layout }))
  return { reference: referenced, batch }
}

/** `el`'s drawn scale, from its transform. */
const scaleOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).a

/** `count` frames. */
const frames = async (count: number): Promise<void> => {
  for (let f = 0; f < count; f++) await raf()
}

/** Every text the page's live region shows from now on, in order. */
const recordAnnouncements = (): { readonly texts: Array<string>; readonly stop: () => void } => {
  const region = document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)
  const texts: Array<string> = []
  const observer = new MutationObserver(() => texts.push((region?.textContent ?? "").replace(/\u00A0$/, "")))
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

describe("Reorder.BatchGroup and Reorder.BatchItem", () => {
  it("BG1: the group lays its items out at their places, a column, a row or a grid, and is sized to them", async () => {
    const column = await mountBatchReorder({ layout: "y" })
    expect(boxOf(column.group()), "the column's group").toEqual({ left: 40, top: 40, width: 200, height: 5 * 50 + 4 * 10 })
    expect(["a", "b", "c", "d", "e"].map((v) => boxOf(column.item(v))), "the column's items").toEqual(
      [0, 1, 2, 3, 4].map((i) => ({ left: 40, top: 40 + i * 60, width: 200, height: 50 })),
    )
    expect([...column.group().children].map((el) => (el as HTMLElement).dataset.value).join(""), "the DOM in the list's order").toBe("abcde")
    await resetScene()
    const row = await mountBatchReorder({ layout: "x" })
    expect(boxOf(row.group()), "the row's group").toEqual({ left: 40, top: 40, width: 5 * 80 + 4 * 10, height: 50 })
    expect(boxOf(row.item("c")), "the row's third").toEqual({ left: 40 + 2 * 90, top: 40, width: 80, height: 50 })
    await resetScene()
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
      await resetScene()
      const batch = await keys(await mountBatchReorder({ layout: "y" }), value, pressed)
      await resetScene()
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
    await resetScene()
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

    // A keyboard lift: whileDrag on, raised; dropped, off and let down.
    b.focus()
    await commands.realKey("press", "Space")
    await wait(400)
    expect(scaleOf(b), "whileDrag while lifted").toBeCloseTo(1.1, 2)
    expect(getComputedStyle(b).zIndex, "raised while lifted").toBe("2")
    await commands.realKey("press", "Space")
    await wait(800)
    expect(scaleOf(b), "whileDrag off at the drop").toBeCloseTo(1, 3)
    expect(getComputedStyle(b).zIndex, "let down once it lands").toBe("auto")
    await resetScene()

    // With no whileDrag a lift and its drop move nothing: the raise goes at once.
    const plain = await mountBatchReorder({ layout: "y" })
    const c = plain.item("c")
    c.focus()
    await commands.realKey("press", "Space")
    await frames(2)
    expect(getComputedStyle(c).zIndex, "raised while lifted").toBe("2")
    await commands.realKey("press", "Space")
    await frames(2)
    expect(getComputedStyle(c).zIndex, "let down at once, nothing moving").toBe("auto")
    await resetScene()

    // Flung down, let go 30 px below its place (short of b's crossover): it carries on down before it turns back.
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

  it("BG5: no item listens at rest, as many listeners for 20 items as for 5; a focus and a blur leave none behind", async () => {
    // Every listener added and removed while it runs, by its target.
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
      await resetScene()
      const afterFive = total()
      const twenty = await mountBatchReorder({ layout: "y", n: 20 })
      expect(total() - afterFive, "as many listeners for 20 items as for 5").toBe(forFive)
      expect(onItems(twenty), "no item listens at rest").toBe(0)
      const atRest = total()
      const b = twenty.item("b")
      b.focus()
      await frames(1)
      b.blur()
      await frames(2)
      expect(total(), "a focus and a blur leave none behind").toBe(atRest)
      expect(onItems(twenty), "no item listens after").toBe(0)
    } finally {
      EventTarget.prototype.addEventListener = realAdd
      EventTarget.prototype.removeEventListener = realRemove
    }
  })

  it("BG7: a drag held near its scroller's bottom edge scrolls it, the item moving down the list under the pointer", async () => {
    const s = await mountBatchReorder({ layout: "y", n: 20, container: 300 })
    const sc = s.scroller as HTMLElement
    const c = s.item("c")
    const g = centreOf(c)
    const grabOffset = grabOffsetOf(c, g)
    const edge = sc.getBoundingClientRect().bottom
    await mouse.down(g)
    const to = { x: g.x, y: edge - 15 }
    await glide(g, to, 20)
    const atHold = sc.scrollTop
    await wait(400)
    expect(sc.scrollTop, "keeps scrolling while the pointer holds still").toBeGreaterThan(atHold + 20)
    await wait(400)
    await frames(4)
    expect(s.order().indexOf("c"), "c moved down the list").toBeGreaterThan(5)
    expect(offPointer(c, to, grabOffset), "the item under the pointer").toBeLessThan(2)
    expect(domOrder(s.group()), "the DOM follows").toBe(s.order().join(""))
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

    // The keyboard reorder on: Space lifts c, and doesn't press it.
    const c = s.item("c")
    c.focus()
    await commands.realKey("down", "Space")
    await wait(300)
    expect(getComputedStyle(c).zIndex, "lifted").toBe("2")
    expect(scaleOf(c), "not pressed").toBeCloseTo(1, 3)
    await commands.realKey("up", "Space")
    await commands.realKey("press", "Space")
    await frames(2)
    // Off: Space presses it.
    setKeyboard(false)
    await commands.realKey("down", "Space")
    await wait(300)
    expect(scaleOf(c), "pressed by Space").toBeCloseTo(0.9, 2)
    expect(getComputedStyle(c).zIndex, "not lifted").toBe("auto")
    await commands.realKey("up", "Space")
    await wait(300)
    expect(scaleOf(c), "the press ends").toBeCloseTo(1, 3)
    // Back on: the next Space lifts.
    setKeyboard(true)
    await commands.realKey("press", "Space")
    await wait(300)
    expect(getComputedStyle(c).zIndex, "lifted again").toBe("2")
    expect(scaleOf(c), "not pressed").toBeCloseTo(1, 3)
    await commands.realKey("press", "Escape")
  }, 30_000)

  it("BP2: a drag takes over a press: whileTap off as it starts, whileDrag on; a function whileTap's keys join", async () => {
    const fast = { type: "spring", stiffness: 500, damping: 40 } as const
    // A function whileTap's keys join the group's from its first item (Q34): `opacity` is no other prop's.
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
    await resetScene()
    const row = await mountBatchReorder({ layout: "x", direction: "rtl" })
    expect(["a", "b", "c", "d", "e"].map((v) => boxOf(row.item(v))), "a row's places, mirrored").toEqual(referenceBoxes)
    await resetScene()
    const inherited = await mountBatchReorder({ layout: "x", rtl: true })
    expect(["a", "b", "c", "d", "e"].map((v) => boxOf(inherited.item(v))), "a page's dir, at once").toEqual(referenceBoxes)
    await resetScene()
    const grid = await mountBatchReorder({ layout: "xy", direction: "rtl" })
    const right = boxOf(grid.group()).left + boxOf(grid.group()).width
    expect(boxOf(grid.item("a")), "a grid's first place at its right edge").toEqual({ left: right - 80, top: 40, width: 80, height: 50 })
    expect(boxOf(grid.item("d")).left, "its second row from the right too").toBe(right - 80)
    await resetScene()

    const paths: ReadonlyArray<Path> = [
      { value: "a", dx: -201, dy: 0, steps: 67 },
      { value: "b", dx: 30, dy: 0, steps: 15 },
    ]
    for (const path of paths) {
      const { reference: r, batch } = await both("x", path, { direction: "rtl" }, { rtl: true })
      expect(batch.reorders, `${path.value} by ${path.dx}: the same orders`).toEqual(r.reorders)
      expect(batch.off, `${path.value} by ${path.dx}: under the pointer`).toBeLessThan(1)
    }
    // An rtl grid's drags: into the next row, and back along it.
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
    await resetScene()
    const batchKeys = await keys(await mountBatchReorder({ layout: "x", direction: "rtl" }), "b", pressed)
    expect(batchKeys.orders, "the arrows' orders").toEqual(byKeys.orders)
    expect(batchKeys.said, "the arrows' announcements").toEqual(byKeys.said)
  }, 60_000)

  it("BC1: a grid's columns from its width, at once as it mounts; widened, more a row, its height following", async () => {
    const [width, setWidth] = createSignal(300)
    const s = await mountBatchReorder({ layout: "xy", n: 10, fromWidth: width, transition: { type: "tween", duration: 0.2 } })
    // 300 px holds three 80 px places 10 px apart.
    expect(boxOf(s.item("d")), "three a row, at once").toEqual({ left: 40, top: 40 + 60, width: 80, height: 50 })
    expect(boxOf(s.group()), "its width the app's, its height its four rows'").toEqual({ left: 40, top: 40, width: 300, height: 4 * 50 + 3 * 10 })
    setWidth(480)
    await wait(500)
    // 480 px holds five.
    expect(boxOf(s.item("d")), "d on the first row").toEqual({ left: 40 + 3 * 90, top: 40, width: 80, height: 50 })
    expect(boxOf(s.item("f")), "f on the second").toEqual({ left: 40, top: 40 + 60, width: 80, height: 50 })
    expect(boxOf(s.group()).height, "two rows").toBe(2 * 50 + 10)
  }, 30_000)

  it("BG10 (Q47): an item with nothing of its own has the group's style, tab stop and instructions, kept as they change", async () => {
    const [size, setSize] = createSignal(80)
    const [instructions, setInstructions] = createSignal<string | undefined>(undefined)
    const [keyboard, setKeyboard] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <Reorder.BatchGroup
          values={["p", "q"]}
          onReorder={() => {}}
          itemSize={{ width: size(), height: 50 }}
          gap={10}
          instructions={instructions()}
          keyboard={keyboard()}
          style={{ position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0" }}
        >
          <Reorder.BatchItem value="p" data-value="p">
            p
          </Reorder.BatchItem>
          <Reorder.BatchItem value="q" data-value="q" tabIndex={-1} aria-describedby="mine" style={{ background: "teal" }}>
            q
          </Reorder.BatchItem>
        </Reorder.BatchGroup>
      </WardicProvider>
    ))
    await wait(50)
    const p = document.querySelector<HTMLElement>('[data-value="p"]')!
    const q = document.querySelector<HTMLElement>('[data-value="q"]')!
    const instructionsOf = (el: HTMLElement): string | undefined => document.getElementById(el.getAttribute("aria-describedby")!.split(" ").at(-1)!)?.textContent ?? undefined
    expect(boxOf(p), "p at its place, sized").toEqual({ left: 40, top: 40, width: 80, height: 50 })
    expect(boxOf(q), "q at its place, sized").toEqual({ left: 40, top: 100, width: 80, height: 50 })
    expect([p.style.position, p.style.top, p.style.left, p.style.touchAction], "absolute at its static position, a column's touch").toEqual(["absolute", "", "", "pan-x"])
    expect(p.getAttribute("draggable")).toBe("false")
    expect(p.getAttribute("tabindex"), "the group's tab stop").toBe("0")
    expect(instructionsOf(p), "the group's instructions").toBe(ReorderController.DEFAULT_INSTRUCTIONS)
    expect(q.getAttribute("tabindex"), "its own tab stop").toBe("-1")
    expect(q.getAttribute("aria-describedby")!.split(" ")[0], "its own ids first").toBe("mine")
    expect(instructionsOf(q), "then the instructions'").toBe(ReorderController.DEFAULT_INSTRUCTIONS)
    expect([q.style.background, q.style.position], "its own style over the group's").toEqual(["teal", "absolute"])
    setSize(120)
    await wait(50)
    expect([boxOf(p).width, boxOf(q).width], "the new size, on both").toEqual([120, 120])
    setInstructions("Drag it, or press Space")
    await wait(50)
    expect([instructionsOf(p), instructionsOf(q)], "the new instructions, on both").toEqual(["Drag it, or press Space", "Drag it, or press Space"])
    setKeyboard(false)
    await wait(50)
    expect([p.hasAttribute("tabindex"), p.hasAttribute("aria-describedby")], "no tab stop and no instructions with the keyboard reorder off").toEqual([false, false])
    expect([q.getAttribute("tabindex"), q.getAttribute("aria-describedby")], "its own kept").toEqual(["-1", "mine"])
    setKeyboard(true)
    await wait(50)
    expect([p.getAttribute("tabindex"), instructionsOf(p)], "back on").toEqual(["0", "Drag it, or press Space"])
    await resetScene()
    // A grid from its width, its items the group's alone: placed at once, then from its first read.
    const [width, setWidth] = createSignal(300)
    const s = await mountBatchReorder({ layout: "xy", n: 10, fromWidth: width, plain: true, transition: { type: "tween", duration: 0.2 } })
    expect(boxOf(s.item("d")), "three a row, at once").toEqual({ left: 40, top: 40 + 60, width: 80, height: 50 })
    expect(s.item("d").style.position, "absolute once it's read").toBe("absolute")
    setWidth(480)
    await wait(500)
    expect(boxOf(s.item("d")), "five a row").toEqual({ left: 40 + 3 * 90, top: 40, width: 80, height: 50 })
  }, 30_000)

  it("BR2: direction taken away after it mounts: the items go to the places the inherited direction gives", async () => {
    const [direction, setDirection] = createSignal<"ltr" | "rtl" | undefined>("rtl")
    const s = await mountBatchReorder({ layout: "x", directionOf: direction, transition: { type: "tween", duration: 0.1 } })
    expect(boxOf(s.item("a")).left, "rtl: a at the right").toBe(40 + 360)
    setDirection(undefined)
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

  it("BG11 (Q20): an item's initial keys but x and y move to their identity as it enters, at its place", async () => {
    const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
    const scaleOfEl = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).a
    const s = await mountBatchReorder({ n: 4, initial: { opacity: 0, scale: 0.8 }, transition: { type: "tween", duration: 0.3 } })
    const c = s.item("c")
    // Settled: at their identity, at their places.
    await wait(400)
    expect(opacityOf(c)).toBe(1)
    expect(scaleOfEl(c)).toBeCloseTo(1, 6)
    expect(boxOf(c).top - boxOf(s.item("a")).top, "at its place").toBe(2 * 60)
    // An item added later enters so: on its way a frame or two in, then there.
    s.setOrder(["a", "b", "c", "d", "e"])
    await raf()
    await raf()
    const e = s.item("e")
    expect(opacityOf(e)).toBeGreaterThan(0)
    expect(opacityOf(e)).toBeLessThan(1)
    await wait(400)
    expect(opacityOf(e)).toBe(1)
    await resetScene()

    // A function's keys, in a grid from its width.
    const [width] = createSignal(300)
    const grid = await mountBatchReorder({ layout: "xy", fromWidth: width, n: 5, initial: (_, i) => ({ opacity: 0, rotate: i * 10 }), transition: { type: "tween", duration: 0.2 } })
    await wait(350)
    const d = grid.item("d")
    expect(opacityOf(d)).toBe(1)
    expect(new DOMMatrix(getComputedStyle(d).transform).b, "no turn left").toBeCloseTo(0, 6)
  }, 30_000)
})

/** Each item's own size by layout (#714): a column's heights, a row's and a grid's widths and heights. */
const HEIGHTS: Readonly<Record<string, number>> = { a: 40, b: 70, c: 50, d: 90, e: 60, f: 30 }
const WIDTHS: Readonly<Record<string, number>> = { a: 80, b: 120, c: 60, d: 100, e: 40, f: 90 }
const SIZE_OF: Readonly<Record<Layout, (value: string) => { readonly width: number; readonly height: number }>> = {
  y: (value) => ({ width: 200, height: HEIGHTS[value]! }),
  x: (value) => ({ width: WIDTHS[value]!, height: HEIGHTS[value]! }),
  // 280 px wide: a, b and c fill the first row to its edge, d, e and f the second.
  xy: (value) => ({ width: WIDTHS[value]!, height: HEIGHTS[value]! }),
}
/** The grid's width: the reference's `LAYOUTS.xy`. */
const GRID_WIDTH = (): number => 280

/** Each value's box under `s`. */
const boxesOf = (s: Scene, values: ReadonlyArray<string>) => values.map((value) => boxOf(s.item(value)))

describe("Reorder.BatchGroup of items of different sizes (#714)", () => {
  it("BD1: each item at the place the browser's flexbox gives it, its own size; the group sized as the flexbox's", async () => {
    for (const [layout, values] of [["y", "abcde"], ["x", "abcde"], ["xy", "abcdef"]] as const) {
      const reference = await mountReorder({ layout, sizeOf: SIZE_OF[layout] })
      const expected = { items: boxesOf(reference, [...values]), group: boxOf(reference.group()) }
      await resetScene()
      const batch = await mountBatchReorder({ layout, sizeOf: SIZE_OF[layout], ...Bool.match(layout === "xy", { onTrue: () => ({ fromWidth: GRID_WIDTH }), onFalse: () => ({}) }) })
      expect(boxesOf(batch, [...values]), `${layout}: the items`).toEqual(expected.items)
      expect(boxOf(batch.group()), `${layout}: the group`).toEqual(expected.group)
      await resetScene()
    }
  }, 30_000)

  it("BD2: a real mouse's drags reorder as a Reorder.Group's of the same sizes on the same paths", async () => {
    const paths: ReadonlyArray<readonly [Layout, Path]> = [
      ["y", { value: "a", dx: 0, dy: 80, steps: 40 }],
      ["y", { value: "d", dx: 0, dy: -150, steps: 50 }],
      ["x", { value: "b", dx: 120, dy: 0, steps: 40 }],
      ["x", { value: "e", dx: -260, dy: 0, steps: 50 }],
      ["xy", { value: "a", dx: 150, dy: 90, steps: 50 }],
      ["xy", { value: "f", dx: -200, dy: -60, steps: 50 }],
    ]
    for (const [layout, path] of paths) {
      const { reference, batch } = await both(layout, path, { sizeOf: SIZE_OF[layout], ...Bool.match(layout === "xy", { onTrue: () => ({ fromWidth: GRID_WIDTH }), onFalse: () => ({}) }) }, { sizeOf: SIZE_OF[layout] })
      expect(reference.reorders.length, `${layout} ${path.value}: the path reorders`).toBeGreaterThan(0)
      expect(batch.reorders, `${layout} ${path.value}: the orders`).toEqual(reference.reorders)
      expect(batch.dom, `${layout} ${path.value}: the DOM`).toBe(reference.dom)
      expect(batch.off, `${layout} ${path.value}: under the pointer`).toBeLessThan(1)
    }
  }, 120_000)

  it("BD3: the function is tracked: a size changed moves the items after it; a new order places each from the sizes before it", async () => {
    const [heights, setHeights] = createSignal<Readonly<Record<string, number>>>(HEIGHTS)
    const s = await mountBatchReorder({ layout: "y", sizeOf: (value) => ({ width: 200, height: heights()[value]! }), transition: { type: "tween", duration: 0.1 } })
    expect(boxesOf(s, ["a", "b", "c"]).map((b) => [b.top, b.height])).toEqual([[40, 40], [90, 70], [170, 50]])
    setHeights({ ...HEIGHTS, b: 100 })
    await wait(400)
    expect(boxOf(s.item("b")).height, "b's own height").toBe(100)
    expect(boxesOf(s, ["c", "d", "e"]).map((b) => b.top), "those after it moved").toEqual([200, 260, 360])
    expect(boxOf(s.group()).height, "the group as tall as them all").toBe(40 + 100 + 50 + 90 + 60 + 4 * 10)
    s.setOrder(["e", "d", "c", "b", "a"])
    await wait(400)
    expect(boxesOf(s, ["e", "d", "c", "b", "a"]).map((b) => [b.top, b.height]), "reversed, each its own size").toEqual([[40, 60], [110, 90], [210, 50], [270, 100], [380, 40]])
  }, 30_000)

  it("BD4: a column whose width is left out: each item the group's content width, border-box; widened, they follow", async () => {
    const sizings: ReadonlyArray<ReorderBatchSizing<string>> = [{ itemSize: { height: 50 } }, { itemSize: (value) => ({ height: HEIGHTS[value]! }) }]
    for (const sizing of sizings) {
      const [width, setWidth] = createSignal(300)
      const [padding, setPadding] = createSignal(10)
      render(() => (
        <WardicProvider env={DomLive}>
          <Reorder.BatchGroup
            values={["a", "b", "c"]}
            onReorder={() => {}}
            {...sizing}
            gap={10}
            style={{ position: "absolute", left: "40px", top: "40px", margin: "0", padding: `${padding()}px`, border: "2px solid", width: `${width()}px` }}
          >
            <For each={["a", "b", "c"]}>
              {(value) => (
                <Reorder.BatchItem value={value} data-value={value} style={{ padding: "8px", border: "1px solid" }}>
                  {value}
                </Reorder.BatchItem>
              )}
            </For>
          </Reorder.BatchGroup>
        </WardicProvider>
      ))
      await wait(100)
      const a = document.querySelector<HTMLElement>('[data-value="a"]')!
      const c = document.querySelector<HTMLElement>('[data-value="c"]')!
      // Inside the group's border and padding: at 52, as wide as its 300 px content box.
      expect([boxOf(a).left, boxOf(a).width, boxOf(c).width], "the group's content width").toEqual([52, 300, 300])
      // Its padding read: its padding box less it, no size container, so a resize is a layout alone (#714).
      expect([a.style.width, a.parentElement!.style.containerType], "read: no container").toEqual(["calc(100% - 20px)", ""])
      setWidth(360)
      await wait(200)
      expect([boxOf(a).width, boxOf(c).width], "widened").toEqual([360, 360])
      // Its padding changed, its content box the same: read again, each item still the content box's width.
      setPadding(20)
      await wait(200)
      expect([boxOf(a).left, boxOf(a).width, boxOf(c).width, a.style.width], "its padding changed").toEqual([62, 360, 360, "calc(100% - 40px)"])
      await resetScene()
    }
  }, 30_000)

  it("BD5: an item added later is sized and placed after the others; a grid's rows wrap again as it narrows", async () => {
    const column = await mountBatchReorder({ layout: "y", sizeOf: SIZE_OF.y })
    column.setOrder(["a", "b", "c", "d", "e", "f"])
    await wait(100)
    expect(boxOf(column.item("f")), "f after e, its own height").toEqual({ left: 40, top: 40 + 40 + 70 + 50 + 90 + 60 + 5 * 10, width: 200, height: 30 })
    expect(boxOf(column.group()).height).toBe(40 + 70 + 50 + 90 + 60 + 30 + 5 * 10)
    await resetScene()
    const [width, setWidth] = createSignal(280)
    const grid = await mountBatchReorder({ layout: "xy", sizeOf: SIZE_OF.xy, fromWidth: width, transition: { type: "tween", duration: 0.1 } })
    expect(boxOf(grid.item("c")), "c ends the first row").toEqual({ left: 40 + 220, top: 40, width: 60, height: 50 })
    setWidth(279.6)
    await wait(400)
    // A fraction of a pixel short, as the flexbox has it: c starts the second row, at the top of it, below b's 70.
    expect(boxOf(grid.item("c")), "c starts the second row").toEqual({ left: 40, top: 40 + 80, width: 60, height: 50 })
    expect(boxOf(grid.item("d")), "d after it").toEqual({ left: 40 + 70, top: 40 + 80, width: 100, height: 90 })
  }, 30_000)

  it("BD6: itemSize switched from one size to a function and back: each item takes the sizes it's given", async () => {
    const one: ReorderBatchSizing<string> = { itemSize: { width: 200, height: 50 } }
    const each: ReorderBatchSizing<string> = { itemSize: (value) => ({ width: 200, height: HEIGHTS[value]! }) }
    const groupWidth: ReorderBatchSizing<string> = { itemSize: { height: 50 } }
    const eachGroupWidth: ReorderBatchSizing<string> = { itemSize: (value) => ({ height: HEIGHTS[value]! }) }
    const [sizing, setSizing] = createSignal<ReorderBatchSizing<string>>(one)
    render(() => (
      <WardicProvider env={DomLive}>
        <Reorder.BatchGroup
          values={["a", "b", "c"]}
          onReorder={() => {}}
          {...sizing()}
          gap={10}
          transition={{ type: "tween", duration: 0.05 }}
          style={{ position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0", width: "300px" }}
        >
          <For each={["a", "b", "c"]}>
            {(value) => (
              <Reorder.BatchItem value={value} data-value={value} {...Bool.match(value === "c", { onTrue: () => ({ style: { background: "teal" } }), onFalse: () => ({}) })}>
                {value}
              </Reorder.BatchItem>
            )}
          </For>
        </Reorder.BatchGroup>
      </WardicProvider>
    ))
    await wait(100)
    const items = (): ReadonlyArray<string> => ["a", "b", "c"].map((value) => {
      const b = boxOf(document.querySelector(`[data-value="${value}"]`)!)
      return `${value} ${b.top} ${b.width}x${b.height}`
    })
    const sizings = (): ReadonlyArray<string> => ["a", "b", "c"].map((value) => getComputedStyle(document.querySelector(`[data-value="${value}"]`)!).boxSizing)
    const switchTo = async (next: ReorderBatchSizing<string>): Promise<void> => {
      setSizing(() => next)
      await wait(300)
    }
    expect(items(), "one size").toEqual(["a 40 200x50", "b 100 200x50", "c 160 200x50"])
    await switchTo(each)
    expect(items(), "each its own").toEqual(["a 40 200x40", "b 90 200x70", "c 170 200x50"])
    await switchTo(groupWidth)
    expect(items(), "one height, the group's width").toEqual(["a 40 300x50", "b 100 300x50", "c 160 300x50"])
    await switchTo(each)
    expect(items(), "each its own again").toEqual(["a 40 200x40", "b 90 200x70", "c 170 200x50"])
    await switchTo(eachGroupWidth)
    expect(items(), "each its own height, the group's width").toEqual(["a 40 300x40", "b 90 300x70", "c 170 300x50"])
    await switchTo(groupWidth)
    expect(items(), "one height, the group's width again").toEqual(["a 40 300x50", "b 100 300x50", "c 160 300x50"])
    expect(sizings(), "border-box, the group's width").toEqual(["border-box", "border-box", "border-box"])
    await switchTo(one)
    expect(items(), "one size again").toEqual(["a 40 200x50", "b 100 200x50", "c 160 200x50"])
    expect(sizings(), "their own sizing back").toEqual(["content-box", "content-box", "content-box"])
  }, 30_000)

  it("BD7: right to left, a row of items each their own width: an rtl Reorder.Group's places and drags", async () => {
    const reference = await mountReorder({ layout: "x", rtl: true, sizeOf: SIZE_OF.x })
    const expected = boxesOf(reference, ["a", "b", "c", "d", "e"])
    await resetScene()
    const row = await mountBatchReorder({ layout: "x", direction: "rtl", sizeOf: SIZE_OF.x })
    expect(boxesOf(row, ["a", "b", "c", "d", "e"]), "its places, from the right edge").toEqual(expected)
    await resetScene()
    const paths: ReadonlyArray<Path> = [
      { value: "a", dx: -150, dy: 0, steps: 50 },
      { value: "b", dx: -120, dy: 0, steps: 40 },
      { value: "e", dx: 260, dy: 0, steps: 60 },
    ]
    for (const path of paths) {
      const { reference: r, batch } = await both("x", path, { direction: "rtl", sizeOf: SIZE_OF.x }, { rtl: true, sizeOf: SIZE_OF.x })
      expect(r.reorders.length, `${path.value} by ${path.dx}: the path reorders`).toBeGreaterThan(0)
      expect(batch.reorders, `${path.value} by ${path.dx}: the same orders`).toEqual(r.reorders)
      expect(batch.off, `${path.value} by ${path.dx}: under the pointer`).toBeLessThan(1)
    }
  }, 120_000)
})

describe("Reorder.BatchGroup of items whose sizes are read from the page (#714)", () => {
  it("BM5: each item at the place the browser's flexbox gives it, its own size; the group sized as the flexbox's", async () => {
    const loops = recordLoopErrors()
    for (const [layout, values] of [["y", "abcde"], ["x", "abcde"], ["xy", "abcdef"]] as const) {
      const reference = await mountReorder({ layout, sizeOf: SIZE_OF[layout] })
      const expected = { items: boxesOf(reference, [...values]), group: boxOf(reference.group()) }
      await resetScene()
      const batch = await mountBatchReorder({ layout, readSizeOf: SIZE_OF[layout], ...Bool.match(layout === "xy", { onTrue: () => ({ fromWidth: GRID_WIDTH }), onFalse: () => ({}) }) })
      await frames(3)
      expect(boxesOf(batch, [...values]), `${layout}: the items`).toEqual(expected.items)
      expect(boxOf(batch.group()), `${layout}: the group`).toEqual(expected.group)
      expect(batch.item("a").style.position, `${layout}: out of flow`).toBe("absolute")
      await resetScene()
    }
    loops.stop()
    expect(loops.count(), "no ResizeObserver loop error").toBe(0)
  }, 30_000)

  it("BM6: a real mouse's drags reorder as a Reorder.Group's of the same sizes on the same paths, right to left too", async () => {
    const loops = recordLoopErrors()
    const paths: ReadonlyArray<readonly [Layout, Path, "ltr" | "rtl"]> = [
      ["y", { value: "a", dx: 0, dy: 80, steps: 40 }, "ltr"],
      ["y", { value: "d", dx: 0, dy: -150, steps: 50 }, "ltr"],
      ["x", { value: "e", dx: -260, dy: 0, steps: 50 }, "ltr"],
      ["x", { value: "a", dx: -150, dy: 0, steps: 50 }, "rtl"],
      ["xy", { value: "a", dx: 150, dy: 90, steps: 50 }, "ltr"],
    ]
    for (const [layout, path, direction] of paths) {
      const rtl = direction === "rtl"
      const { reference, batch } = await both(
        layout,
        path,
        { readSizeOf: SIZE_OF[layout], ...Bool.match(layout === "xy", { onTrue: () => ({ fromWidth: GRID_WIDTH }), onFalse: () => ({}) }), ...Bool.match(rtl, { onTrue: () => ({ direction }), onFalse: () => ({}) }) },
        { sizeOf: SIZE_OF[layout], rtl },
      )
      const name = `${layout} ${direction} ${path.value}`
      expect(reference.reorders.length, `${name}: the path reorders`).toBeGreaterThan(0)
      expect(batch.reorders, `${name}: the orders`).toEqual(reference.reorders)
      expect(batch.dom, `${name}: the DOM`).toBe(reference.dom)
      expect(batch.off, `${name}: under the pointer`).toBeLessThan(1)
    }
    loops.stop()
    expect(loops.count(), "no ResizeObserver loop error").toBe(0)
  }, 120_000)

  it("BM7: an item's size changed is read: the items after it move on the group's transition, and the group follows", async () => {
    const loops = recordLoopErrors()
    const [heights, setHeights] = createSignal<Readonly<Record<string, number>>>(HEIGHTS)
    const s = await mountBatchReorder({ layout: "y", readSizeOf: (value) => ({ width: 200, height: heights()[value]! }), transition: { type: "tween", duration: 0.2 } })
    await frames(3)
    expect(boxesOf(s, ["a", "b", "c"]).map((b) => [b.top, b.height])).toEqual([[40, 40], [90, 70], [170, 50]])
    setHeights({ ...HEIGHTS, b: 100 })
    await frames(3)
    const c = boxOf(s.item("c")).top
    expect(Bool.and(c > 170, c < 200), `c on its way, at ${c}`).toBe(true)
    await wait(400)
    expect(boxOf(s.item("b")).height, "b's new height").toBe(100)
    expect(boxesOf(s, ["c", "d", "e"]).map((b) => b.top), "those after it moved").toEqual([200, 260, 360])
    expect(boxOf(s.group()).height, "the group as tall as them all").toBe(40 + 100 + 50 + 90 + 60 + 4 * 10)
    loops.stop()
    expect(loops.count(), "no ResizeObserver loop error").toBe(0)
  }, 30_000)

  it("BM8: rows of text as wide as the group, stacked a gap apart; widened, read again and stacked again", async () => {
    const loops = recordLoopErrors()
    const [width, setWidth] = createSignal(240)
    const texts = Array.from({ length: 12 }, (_, i) => `row ${i} ${"and more words ".repeat(1 + (i * 7) % 5)}`)
    let group: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <Reorder.BatchGroup
          ref={(el: HTMLElement) => (group = el)}
          values={texts}
          onReorder={() => {}}
          gap={4}
          transition={{ type: "tween", duration: 0.05 }}
          style={{ position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0", width: `${width()}px`, "font-size": "16px", "line-height": "20px", "list-style": "none" }}
        >
          <For each={texts}>
            {(text) => (
              <Reorder.BatchItem value={text} style={{ padding: "4px 8px", border: "1px solid" }}>
                {text}
              </Reorder.BatchItem>
            )}
          </For>
        </Reorder.BatchGroup>
      </WardicProvider>
    ))
    await wait(100)
    const items = [...group!.querySelectorAll<HTMLElement>(":scope > li")]
    expect(new Set(items.map((el) => el.getBoundingClientRect().height)).size, "rows of different heights").toBeGreaterThan(1)
    expect(unstacked(group!, items, 4), "stacked as they mount").toEqual([])
    const tall = group!.getBoundingClientRect().height
    setWidth(400)
    await wait(300)
    expect(items.every((el) => Math.round(el.getBoundingClientRect().width) === 400), "as wide as the group").toBe(true)
    expect(unstacked(group!, items, 4), "stacked again, widened").toEqual([])
    expect(group!.getBoundingClientRect().height, "shorter, its rows wrapping less").toBeLessThan(tall)
    loops.stop()
    expect(loops.count(), "no ResizeObserver loop error").toBe(0)
  }, 30_000)

  it("BM9: an item added later is read and placed after the others; one put in the middle, those after it make room", async () => {
    const loops = recordLoopErrors()
    const s = await mountBatchReorder({ layout: "y", readSizeOf: SIZE_OF.y, transition: { type: "tween", duration: 0.1 } })
    s.setOrder(["a", "b", "c", "d", "e", "f"])
    await wait(300)
    expect(boxOf(s.item("f")), "f after e, its own height").toEqual({ left: 40, top: 40 + 40 + 70 + 50 + 90 + 60 + 5 * 10, width: 200, height: 30 })
    await resetScene()
    const middle = await mountBatchReorder({ layout: "y", readSizeOf: SIZE_OF.y, transition: { type: "tween", duration: 0.1 } })
    middle.setOrder(["a", "f", "b", "c", "d", "e"])
    await wait(300)
    expect(boxesOf(middle, ["a", "f", "b", "c", "d", "e"]).map((b) => b.top), "room made for f").toEqual([40, 90, 130, 210, 270, 370])
    expect(boxOf(middle.group()).height).toBe(40 + 30 + 70 + 50 + 90 + 60 + 5 * 10)
    loops.stop()
    expect(loops.count(), "no ResizeObserver loop error").toBe(0)
  }, 30_000)

  it("BM10: no flight as they mount: out of flow at their places from the first frame, as at rest", async () => {
    const s = await mountBatchReorder({ layout: "y", readSizeOf: SIZE_OF.y, transition: { type: "tween", duration: 1 } })
    // `mountBatchReorder` settles over 4 frames: a flight of a second from a guess would still be under way.
    const now = boxesOf(s, ["a", "b", "c", "d", "e"])
    await wait(1200)
    expect(now, "where they rest").toEqual(boxesOf(s, ["a", "b", "c", "d", "e"]))
  }, 30_000)

  it("BM11: a border-box group with padding and a border, read or one size: sized to its places and its edges", async () => {
    const loops = recordLoopErrors()
    const edges = { position: "absolute", left: "40px", top: "40px", margin: "0", padding: "12px", border: "2px solid", "box-sizing": "border-box" } as const
    for (const sizing of [{}, { itemSize: { width: 200, height: 50 } }] as ReadonlyArray<ReorderBatchSizing<string>>) {
      const read = Predicate.isUndefined(sizing.itemSize)
      render(() => (
        <WardicProvider env={DomLive}>
          <Reorder.BatchGroup values={["a", "b", "c"]} onReorder={() => {}} {...sizing} gap={10} style={{ ...edges, ...Bool.match(read, { onTrue: () => ({ width: "228px" }), onFalse: () => ({}) }) }}>
            <For each={["a", "b", "c"]}>
              {(value) => (
                <Reorder.BatchItem value={value} data-value={value} style={Bool.match(read, { onTrue: () => ({ height: `${HEIGHTS[value]}px`, "box-sizing": "border-box" }), onFalse: () => ({}) })}>
                  {value}
                </Reorder.BatchItem>
              )}
            </For>
          </Reorder.BatchGroup>
        </WardicProvider>
      ))
      await wait(150)
      const group = document.querySelector<HTMLElement>('[data-value="a"]')!.parentElement!
      const g = group.getBoundingClientRect()
      const items = ["a", "b", "c"].map((value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!.getBoundingClientRect())
      const heights = Bool.match(read, { onTrue: () => 40 + 70 + 50, onFalse: () => 3 * 50 })
      expect([g.width, g.height], `${Bool.match(read, { onTrue: () => "read", onFalse: () => "one size" })}: its places and its edges`).toEqual([228, heights + 2 * 10 + 2 * 14])
      expect([items[0]!.left - g.left, items[0]!.top - g.top, items[0]!.width], "the first item inside them").toEqual([14, 14, 200])
      expect(g.bottom - items[2]!.bottom, "the last item inside them").toBeCloseTo(14, 1)
      // Read: each item its padding box less its padding, no size container (#714).
      if (read) expect([document.querySelector<HTMLElement>('[data-value="a"]')!.style.width, group.style.containerType], "no container once read").toEqual(["calc(100% - 24px)", ""])
      await resetScene()
    }
    loops.stop()
    expect(loops.count(), "no ResizeObserver loop error").toBe(0)
  }, 30_000)

  it("BM12: switched to sizes read from the page at runtime and back: no flight from a guess, and no pile", async () => {
    const sheet = document.createElement("style")
    sheet.textContent = ["a", "b", "c"].map((value) => `[data-value="${value}"] { height: ${HEIGHTS[value]}px; box-sizing: border-box }`).join("\n")
    document.head.append(sheet)
    const one: ReorderBatchSizing<string> = { itemSize: { width: 200, height: 50 } }
    const each: ReorderBatchSizing<string> = { itemSize: (value) => ({ width: 200, height: HEIGHTS[value]! }) }
    const read: ReorderBatchSizing<string> = {}
    const [sizing, setSizing] = createSignal<ReorderBatchSizing<string>>(one)
    render(() => (
      <WardicProvider env={DomLive}>
        <Reorder.BatchGroup
          values={["a", "b", "c"]}
          onReorder={() => {}}
          {...sizing()}
          gap={10}
          transition={{ type: "tween", duration: 1 }}
          style={{ position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0", width: "200px" }}
        >
          <For each={["a", "b", "c"]}>{(value) => <Reorder.BatchItem value={value} data-value={value}>{value}</Reorder.BatchItem>}</For>
        </Reorder.BatchGroup>
      </WardicProvider>
    ))
    await wait(100)
    const tops = (): ReadonlyArray<number> => ["a", "b", "c"].map((value) => boxOf(document.querySelector(`[data-value="${value}"]`)!).top)
    const atRest = [40, 90, 170]
    const switchTo = async (next: ReorderBatchSizing<string>): Promise<void> => {
      setSizing(() => next)
      await frames(4)
    }
    await switchTo(read)
    expect(tops(), "from one size: read, at once").toEqual(atRest)
    await switchTo(each)
    await wait(1100)
    expect(tops(), "a function's").toEqual(atRest)
    await switchTo(read)
    expect(tops(), "from a function's: read, at once").toEqual(atRest)
    await switchTo(each)
    await wait(1100)
    await switchTo(read)
    expect(tops(), "read again: no pile").toEqual(atRest)
    sheet.remove()
  }, 30_000)

  it("BM13: hidden under an ancestor and shown again: no flight from a pile, each item's last size kept", async () => {
    const [shown, setShown] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ display: Bool.match(shown(), { onTrue: () => "block", onFalse: () => "none" }) }}>
          <Reorder.BatchGroup values={["a", "b", "c"]} onReorder={() => {}} gap={10} transition={{ type: "tween", duration: 1 }} style={{ position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0", width: "200px" }}>
            <For each={["a", "b", "c"]}>
              {(value) => (
                <Reorder.BatchItem value={value} data-value={value} style={{ height: `${HEIGHTS[value]}px` }}>
                  {value}
                </Reorder.BatchItem>
              )}
            </For>
          </Reorder.BatchGroup>
        </div>
      </WardicProvider>
    ))
    await wait(100)
    const tops = (): ReadonlyArray<number> => ["a", "b", "c"].map((value) => boxOf(document.querySelector(`[data-value="${value}"]`)!).top)
    expect(tops()).toEqual([40, 90, 170])
    setShown(false)
    await frames(4)
    setShown(true)
    await frames(4)
    expect(tops(), "shown, where they were").toEqual([40, 90, 170])
  }, 30_000)

  it("BM14: a column emptied keeps its width the app's; filled again, its items take it", async () => {
    const s = await mountBatchReorder({ layout: "y", readSizeOf: SIZE_OF.y })
    s.setOrder([])
    await wait(100)
    expect(s.group().style.width, "emptied: the app's width").toBe("200px")
    s.setOrder(["a", "b"])
    // New items, read as they come: those after one make room for it on the group's transition.
    await wait(800)
    expect(boxesOf(s, ["a", "b"]), "filled again").toEqual([{ left: 40, top: 40, width: 200, height: 40 }, { left: 40, top: 90, width: 200, height: 70 }])
  }, 30_000)
})

