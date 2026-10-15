import type * as Box from "@wardic/core/Box"
import * as Reorder from "@wardic/core/Reorder"
import * as Option from "effect/Option"
import { describe, expect, it } from "@effect/vitest"

// The keyboard reorder (#43, ADR-0037): core's model, against fake item sources as in
// `reorder-group.test.ts`: the keys' meaning, the on-screen step (a column, a reversed column,
// an rtl row, a grid), the guard that waits for a Measure pass after each step, Home and End,
// a cancel restoring the order from the lift, and the default wording.

const box = (left: number, top: number, right: number, bottom: number): Box.Box => ({
  x: { min: left, max: right },
  y: { min: top, max: bottom },
})

/** A column's slot at index `i`: 200 x 50, 10 px apart. */
const slot = (i: number): Box.Box => box(0, 60 * i, 200, 60 * i + 50)
/** A reversed column (`column-reverse`): index 0 at the bottom of five. */
const reversedSlot = (i: number): Box.Box => slot(4 - i)
/** An rtl row's slot at index `i`: index 0 at the right of five. */
const rtlRowSlot = (i: number): Box.Box => box(90 * (4 - i), 0, 90 * (4 - i) + 80, 50)
/** A grid of three columns: index `i` at row ⌊i / 3⌋, column i mod 3. */
const gridSlot = (i: number): Box.Box => box(90 * (i % 3), 60 * Math.floor(i / 3), 90 * (i % 3) + 80, 60 * Math.floor(i / 3) + 50)

interface FakeSource extends Reorder.ItemSource {
  layout: Box.Box
  version: number
}

const harness = <V,>(initial: ReadonlyArray<V>, options: { readonly slotOf?: (i: number) => Box.Box; readonly direction?: "ltr" | "rtl" } = {}) => {
  const slotOf = options.slotOf ?? slot
  const state = { values: [...initial] as Array<V>, calls: [] as Array<ReadonlyArray<V>>, sources: new Map<V, FakeSource>() }
  const group = Reorder.make<V>({
    values: () => state.values,
    onReorder: (next) => {
      state.calls.push(next)
      state.values = next
    },
    ...(options.direction !== undefined ? { direction: () => options.direction ?? "ltr" } : {}),
  })
  initial.forEach((v, i) => {
    const s: FakeSource = { layout: slotOf(i), version: 1, layoutBox: () => Option.some(s.layout), dragOffset: () => ({ x: 0, y: 0 }), layoutVersion: () => s.version }
    state.sources.set(v, s)
    Reorder.register(group, v, s)
  })
  /** A Measure pass: slots follow `values`, versions rise. */
  const pass = (): void => {
    state.values.forEach((v, i) => {
      const s = state.sources.get(v)!
      s.layout = slotOf(i)
      s.version++
    })
  }
  /** Step `value` once with `key`, then run a Measure pass, as the engine would before the next key. */
  const press = (value: V, key: string) => {
    const intent = Option.getOrThrow(Reorder.keyIntent(key))
    if (intent._tag !== "Step" && intent._tag !== "End") throw new Error(`not a step: ${key}`)
    const placement = Option.getOrThrow(Reorder.step(group, value, intent))
    pass()
    return placement
  }
  return { state, group, pass, press }
}

describe("the keyboard reorder (#43)", () => {
  it("KR1: Space and Enter toggle, Escape cancels, the arrows step, Home and End jump; other keys do nothing", () => {
    expect(Reorder.keyIntent(" ")).toEqual(Option.some({ _tag: "Toggle" }))
    expect(Reorder.keyIntent("Enter")).toEqual(Option.some({ _tag: "Toggle" }))
    expect(Reorder.keyIntent("Escape")).toEqual(Option.some({ _tag: "Cancel" }))
    expect(Reorder.keyIntent("ArrowDown")).toEqual(Option.some({ _tag: "Step", arrow: "down" }))
    expect(Reorder.keyIntent("ArrowLeft")).toEqual(Option.some({ _tag: "Step", arrow: "left" }))
    expect(Reorder.keyIntent("Home")).toEqual(Option.some({ _tag: "End", end: "first" }))
    expect(Reorder.keyIntent("End")).toEqual(Option.some({ _tag: "End", end: "last" }))
    for (const key of ["a", "Tab", "Shift", "PageDown", "Spacebar"]) expect(Reorder.keyIntent(key), key).toEqual(Option.none())
  })

  it("KR2: lift, two steps down and a drop move the item one place per press, through onReorder, with its 1-based place", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    expect(Reorder.lift(h.group, "b")).toEqual(Option.some({ position: 2, count: 5, moved: false, waiting: false }))
    expect(Reorder.liftedValue(h.group)).toEqual(Option.some("b"))
    expect(h.press("b", "ArrowDown")).toEqual({ position: 3, count: 5, moved: true, waiting: false })
    expect(h.press("b", "ArrowDown")).toEqual({ position: 4, count: 5, moved: true, waiting: false })
    expect(h.state.calls).toEqual([
      ["a", "c", "b", "d", "e"],
      ["a", "c", "d", "b", "e"],
    ])
    expect(Reorder.drop(h.group, "b")).toEqual(Option.some({ position: 4, count: 5, moved: false, waiting: false }))
    expect(Reorder.liftedValue(h.group)).toEqual(Option.none())
  })

  it("KR3: after a step, the next one waits until a Measure pass has measured the new order", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    Reorder.lift(h.group, "b")
    Reorder.step(h.group, "b", { _tag: "Step", arrow: "down" })
    // Read against the old boxes, c (now above b in values) would look below it, and b would step back.
    expect(Reorder.step(h.group, "b", { _tag: "Step", arrow: "down" })).toEqual(Option.some({ position: 3, count: 5, moved: false, waiting: true }))
    expect(h.state.calls).toHaveLength(1)
    h.pass()
    expect(Reorder.step(h.group, "b", { _tag: "Step", arrow: "down" })).toEqual(Option.some({ position: 4, count: 5, moved: true, waiting: false }))
  })

  it("KR4: at an end an arrow moves nothing; Home and End go to the first and last place; arrows off the axis do nothing", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    Reorder.lift(h.group, "a")
    expect(h.press("a", "ArrowUp")).toEqual({ position: 1, count: 5, moved: false, waiting: false })
    expect(h.press("a", "ArrowLeft")).toEqual({ position: 1, count: 5, moved: false, waiting: false })
    expect(h.press("a", "End")).toEqual({ position: 5, count: 5, moved: true, waiting: false })
    expect(h.state.values).toEqual(["b", "c", "d", "e", "a"])
    expect(h.press("a", "ArrowDown")).toEqual({ position: 5, count: 5, moved: false, waiting: false })
    expect(h.press("a", "Home")).toEqual({ position: 1, count: 5, moved: true, waiting: false })
    expect(h.state.values).toEqual(["a", "b", "c", "d", "e"])
    expect(h.state.calls).toHaveLength(2)
  })

  it("KR5: by what's on screen: in a reversed column Up moves the item to a later index; in an rtl row Left does", () => {
    const column = harness(["a", "b", "c", "d", "e"], { slotOf: reversedSlot })
    Reorder.lift(column.group, "b")
    // b is second from the bottom; the item above it on screen is c.
    expect(column.press("b", "ArrowUp")).toEqual({ position: 3, count: 5, moved: true, waiting: false })
    expect(column.state.values).toEqual(["a", "c", "b", "d", "e"])

    const row = harness(["a", "b", "c", "d", "e"], { slotOf: rtlRowSlot, direction: "rtl" })
    Reorder.lift(row.group, "b")
    // b is second from the right; the item left of it on screen is c.
    expect(row.press("b", "ArrowLeft")).toEqual({ position: 3, count: 5, moved: true, waiting: false })
    expect(row.press("b", "ArrowRight")).toEqual({ position: 2, count: 5, moved: true, waiting: false })
    expect(row.state.values).toEqual(["a", "b", "c", "d", "e"])
  })

  it("KR6: in a grid, Left and Right step in reading order and wrap across rows; Up and Down change rows to the nearest centre", () => {
    const h = harness(["a", "b", "c", "d", "e", "f", "g", "h", "i"], { slotOf: gridSlot })
    Reorder.lift(h.group, "c")
    // c ends the first row: Right wraps to the second row's first place.
    expect(h.press("c", "ArrowRight")).toEqual({ position: 4, count: 9, moved: true, waiting: false })
    expect(h.state.values).toEqual(["a", "b", "d", "c", "e", "f", "g", "h", "i"])
    // Down takes the place below it: the third row's first.
    expect(h.press("c", "ArrowDown")).toEqual({ position: 7, count: 9, moved: true, waiting: false })
    expect(h.state.values).toEqual(["a", "b", "d", "e", "f", "g", "c", "h", "i"])
    // Down again: no row below.
    expect(h.press("c", "ArrowDown")).toEqual({ position: 7, count: 9, moved: false, waiting: false })
    expect(h.press("c", "ArrowUp")).toEqual({ position: 4, count: 9, moved: true, waiting: false })
    expect(h.press("c", "ArrowLeft")).toEqual({ position: 3, count: 9, moved: true, waiting: false })

    const rtl = harness(["a", "b", "c", "d", "e", "f"], { slotOf: gridSlot, direction: "rtl" })
    Reorder.lift(rtl.group, "b")
    // In rtl reading order runs the other way: Left is the next place.
    expect(rtl.press("b", "ArrowLeft")).toEqual({ position: 3, count: 6, moved: true, waiting: false })
  })

  it("KR7: a cancel restores the order from the lift, through onReorder; with nothing moved it calls nothing", () => {
    const h = harness(["a", "b", "c", "d", "e"])
    Reorder.lift(h.group, "b")
    h.press("b", "ArrowDown")
    h.press("b", "ArrowDown")
    expect(Reorder.cancel(h.group, "b")).toEqual(Option.some({ position: 2, count: 5, moved: false, waiting: false }))
    expect(h.state.values).toEqual(["a", "b", "c", "d", "e"])
    expect(h.state.calls).toHaveLength(3)
    expect(Reorder.liftedValue(h.group)).toEqual(Option.none())

    Reorder.lift(h.group, "d")
    expect(Reorder.cancel(h.group, "d")).toEqual(Option.some({ position: 4, count: 5, moved: false, waiting: false }))
    expect(h.state.calls).toHaveLength(3)
  })

  it("KR8: the axis and direction are fixed at the lift; nothing but the lifted item steps, drops or cancels", () => {
    let axis: Reorder.Axis | undefined
    const h = harness(["a", "b", "c"])
    const group = Reorder.make<string>({ values: () => h.state.values, onReorder: (next) => (h.state.values = next), axis: () => Option.fromUndefinedOr(axis) })
    for (const [v, s] of h.state.sources) Reorder.register(group, v, s)
    axis = "y"
    Reorder.lift(group, "a")
    axis = "x"
    // Still a column for this lift: Down steps.
    expect(Option.getOrThrow(Reorder.step(group, "a", { _tag: "Step", arrow: "down" })).moved).toBe(true)
    expect(Reorder.step(group, "b", { _tag: "Step", arrow: "down" })).toEqual(Option.none())
    expect(Reorder.drop(group, "b")).toEqual(Option.none())
    expect(Reorder.cancel(group, "c")).toEqual(Option.none())
    expect(Reorder.lift(group, "z")).toEqual(Option.none())
  })

  it("KR9: the default wording names the item and its place; the instructions name the keys and focus mode", () => {
    const info = { value: "milk", label: "Milk", position: 3, count: 6 }
    expect(Reorder.defaultAnnouncements.lift(info)).toBe("Picked up Milk, position 3 of 6.")
    expect(Reorder.defaultAnnouncements.step(info)).toBe("Milk, position 3 of 6.")
    expect(Reorder.defaultAnnouncements.drop(info)).toBe("Dropped Milk at position 3 of 6.")
    expect(Reorder.defaultAnnouncements.cancel(info)).toBe("Cancelled. Milk is back at position 3 of 6.")
    expect(Reorder.defaultAnnouncements.move(info)).toBe("Moved Milk to position 3 of 6.")
    expect(Reorder.DEFAULT_INSTRUCTIONS).toBe(
      "Press Space or Enter to pick up. Use the arrow keys to move, Space or Enter to drop, Escape to cancel. Some screen readers need focus mode for these keys.",
    )
  })
})
