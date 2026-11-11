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
// - BG8: a grab stops an item flying back from a release; a press with no drag lets it go on.
// - BG9: a function `whileDrag`'s keys join the group's.
// - BG6: `groupRef`'s group (Q25): its `next`, `when` and `each` of `holdStart`, `reorderEnd` and `holdEnd`,
//   as `reorderGroup()`'s, its `axis`, and `move`, announced.
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
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
const both = async (layout: Layout, path: Path, options: BatchSceneOptions = {}) => {
  const run = async (s: Scene) => {
    const { to, grabOffset } = await drag(s, path.value, path.dx, path.dy, path.steps)
    const result = { reorders: joined(s.reorders), dom: domOrder(s.group()), off: offPointer(s.item(path.value), to, grabOffset) }
    await mouse.up(to)
    await resetBatchScene()
    return result
  }
  const reference = await run(await mountReorder({ layout, axis: () => layout }))
  const batch = await run(await mountBatchReorder({ ...options, layout }))
  return { reference, batch }
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
})
