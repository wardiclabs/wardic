// Issue #44's reorder runs (`reorderRunOf`, `reorderChecksOf`), in the node test tier.
// The fixtures are small inputs shaped like scenario 14's runs: a y list of six 180x36
// items 8px apart (a 44px pitch), b grabbed at its centre and dragged 46px down past c.
// The recorder's first rAF after the grab is frame 1, frames are 16 ms apart, and each
// move is handled between one frame's paint and the next frame's rAF.
import { describe, expect, it } from "vitest"
import { type Box, type DragFrame, type DragMove, type DragRunInput, dragChecksOf, dragRunOf } from "../src/lab/drag-run.ts"
import { REORDER_CHECK_NAMES, type ReorderEvent, type ReorderFrame, reorderChecksOf, reorderRunOf } from "../src/lab/reorder-run.ts"

const VALUES = ["a", "b", "c", "d", "e", "f"]
const slot = (i: number): Box => ({ x: 0, y: 44 * i, width: 180, height: 36 })
const moved = (b: Box, dy: number): Box => ({ ...b, y: b.y + dy })

/** Every item at its slot for `order`, with `dragged` painted `dy` below its grab slot. */
const frameOf = (
  order: ReadonlyArray<string>,
  opts: { readonly dragged?: string; readonly paint?: Box; readonly hit?: string | null; readonly inDragged?: boolean; readonly shift?: Readonly<Record<string, number>> } = {},
): ReorderFrame => {
  const items: Record<string, Box> = {}
  const slots: Record<string, Box> = {}
  order.forEach((v, i) => {
    slots[v] = slot(i)
    items[v] = moved(slot(i), opts.shift?.[v] ?? 0)
  })
  if (opts.dragged !== undefined && opts.paint !== undefined) items[opts.dragged] = opts.paint
  return { items, slots, hit: opts.hit === undefined ? (opts.dragged ?? null) : opts.hit, pointerInDragged: opts.inDragged ?? true }
}

const AFTER = ["a", "c", "b", "d", "e", "f"]

/** One press of b: `steps` moves of `dy` each, a reorder after the move that crosses c's centre, the release after the last frame. */
const pressOf = (
  opts: {
    readonly frames?: ReadonlyArray<ReorderFrame>
    readonly reorders?: ReadonlyArray<ReorderEvent>
    readonly moves?: ReadonlyArray<DragMove>
    readonly axis?: string
    readonly scroll?: { readonly grab: number; readonly end: number; readonly hand: number }
  } = {},
): DragRunInput => {
  const moves = opts.moves ?? Array.from({ length: 10 }, (_, k): DragMove => ({ t: 8 + 16 * k, frame: k, dx: 0, dy: 4.6 * (k + 1), buttons: 1 }))
  const reorderFrames =
    opts.frames ??
    Array.from({ length: 12 }, (_, k): ReorderFrame => {
      const dy = Math.min(4.6 * k, 46)
      const order = k >= 8 ? AFTER : VALUES
      const grab = slot(1)
      return frameOf(order, { dragged: "b", paint: moved(grab, dy) })
    })
  const frames: Array<DragFrame> = reorderFrames.map((r, i) => ({
    frame: i + 1,
    frameAt: 16 * (i + 1),
    t: 16 * (i + 1) + 4,
    d: r.items.b ?? slot(1),
    slot: r.slots.b ?? slot(1),
    children: {},
    reorder: r,
  }))
  const scroll = opts.scroll ?? { grab: 0, end: 0, hand: 0 }
  return {
    scenarioId: "reorder",
    mode: "y",
    grabAt: 0,
    grabBox: slot(1),
    moves,
    frames,
    childOffsets: {},
    releaseAt: 16 * (frames.length + 1) - 4,
    endedAt: 16 * (frames.length + 2),
    reorder: {
      layout: "y",
      axis: opts.axis ?? "y",
      dragged: "b",
      orderAtGrab: VALUES,
      reorders: opts.reorders ?? [{ t: 120, frame: 7, order: AFTER }],
      scrollAtGrab: { x: 0, y: scroll.grab },
      scrollAtEnd: { x: 0, y: scroll.end },
      scrolledByHand: { x: 0, y: scroll.hand },
    },
  }
}

const EXPECT = { oneStep: true, uninvolvedMaxPx: 1, raised: true } as const
const lines = (input: DragRunInput) => Object.fromEntries(reorderChecksOf(input, EXPECT).map((c) => [c.name, c]))

describe("reorder runs (#44, scenario 14)", () => {
  it("L1: a clean run: one reorder one place, dropped on the nearest slot, nothing else moves, raised throughout", () => {
    const l = lines(pressOf())
    expect(Object.keys(l)).toEqual([...REORDER_CHECK_NAMES])
    expect(l.reorders).toEqual({ name: "reorders", ok: true, text: "1 · one place each · dropped on the nearest slot ✓" })
    expect(l["uninvolved still"]).toEqual({ name: "uninvolved still", ok: true, text: "0.00 px · 4 items ✓" })
    expect(l.raised!.ok).toBe(true)
    expect(l.raised!.text).toMatch(/^\d+\/\d+ frames on top ✓$/)
    expect(l["auto-scrolled"]).toEqual({ name: "auto-scrolled", ok: true, text: "0.00 px" })
  })

  it("L2: on a single axis a reorder that moves the item two places fails the reorders line", () => {
    const skip = ["a", "c", "d", "b", "e", "f"]
    const l = lines(pressOf({ reorders: [{ t: 120, frame: 7, order: skip }] }))
    expect(l.reorders!.ok).toBe(false)
    expect(l.reorders!.text).toContain("places 2")
  })

  it("L3: in a grid a move of several places isn't judged (a move to another row)", () => {
    const skip = ["a", "c", "d", "b", "e", "f"]
    const l = lines(pressOf({ axis: "xy", reorders: [{ t: 120, frame: 7, order: skip }] }))
    expect(l.reorders!.ok).toBe(true)
    expect(l.reorders!.text).toContain("places 2")
  })

  it("L4b: an item still landing at the grab is left out and counted; one at rest that flies still fails (#142)", () => {
    // e lands from 6 px off its slot over the press (the last press's reorder, cut short by this one).
    const landing = (k: number): number => Math.max(0, 6 - k)
    const frames = Array.from({ length: 12 }, (_, k) =>
      frameOf(k >= 8 ? AFTER : VALUES, { dragged: "b", paint: moved(slot(1), Math.min(4.6 * k, 46)), shift: { e: landing(k) } }),
    )
    const run = reorderRunOf(pressOf({ frames }))!
    expect(run.settlingAtGrab).toEqual(["e"])
    expect(run.uninvolved).toEqual(["a", "d", "f"])
    expect(lines(pressOf({ frames }))["uninvolved still"]).toEqual({ name: "uninvolved still", ok: true, text: "0.00 px · 3 items · 1 settling at the grab, left out ✓" })
    // f at rest at the grab, then thrown 20 px: it still fails beside the landing e.
    const thrown = frames.map((f, k) => (k === 9 ? { ...f, items: { ...f.items, f: moved(f.items.f!, 20) } } : f))
    expect(lines(pressOf({ frames: thrown }))["uninvolved still"]).toEqual({
      name: "uninvolved still",
      ok: false,
      text: "20.00 px · 3 items · 1 settling at the grab, left out ✗ expected ≤ 1 px",
    })
  })

  it("L4: an uninvolved item that flies fails its line, with how far", () => {
    const frames = Array.from({ length: 12 }, (_, k) =>
      frameOf(k >= 8 ? AFTER : VALUES, { dragged: "b", paint: moved(slot(1), Math.min(4.6 * k, 46)), shift: { e: k === 9 ? 58.4 : 0 } }),
    )
    const l = lines(pressOf({ frames }))
    expect(l["uninvolved still"]!.ok).toBe(false)
    expect(l["uninvolved still"]!.text).toBe("58.40 px · 4 items ✗ expected ≤ 1 px")
  })

  it("L5: a frame with a sibling at the pointer while the pointer is inside the dragged item fails raised", () => {
    const frames = Array.from({ length: 12 }, (_, k) =>
      frameOf(k >= 8 ? AFTER : VALUES, { dragged: "b", paint: moved(slot(1), Math.min(4.6 * k, 46)), hit: k === 9 ? "c" : "b" }),
    )
    const run = reorderRunOf(pressOf({ frames }))!
    expect(run.raisedMisses).toBe(1)
    const l = lines(pressOf({ frames }))
    expect(l.raised!.ok).toBe(false)
    expect(l.raised!.text).toMatch(/^\d+\/\d+ frames on top ✗ expected every frame$/)
  })

  it("L6: auto-scrolled is the scroller's movement past the S key's, reported and not judged", () => {
    const l = lines(pressOf({ scroll: { grab: 40, end: 220, hand: 60 } }))
    expect(l["auto-scrolled"]).toEqual({ name: "auto-scrolled", ok: true, text: "120.00 px" })
  })

  it("L7: a press that never moves past the drag threshold reads click on every line", () => {
    const l = lines(pressOf({ moves: [{ t: 8, frame: 0, dx: 1, dy: 2, buttons: 1 }], reorders: [] }))
    for (const name of REORDER_CHECK_NAMES) expect(l[name]).toEqual({ name, ok: true, text: "click, no drag" })
  })

  it("L8: a drag run with no reorder data has no reorder lines", () => {
    const { reorder: _reorder, ...plain } = pressOf()
    expect(reorderChecksOf(plain, EXPECT)).toEqual([])
    expect(reorderRunOf(plain)).toBeUndefined()
  })

  it("L9: a drop past a neighbour's slot before the next reorder is reported, not judged", () => {
    // Released 80px down: b's centre (62 + 80 = 142) is nearest d's slot (132-168), one place past where b ends.
    const frames = Array.from({ length: 12 }, (_, k) =>
      frameOf(k >= 8 ? AFTER : VALUES, { dragged: "b", paint: moved(slot(1), k === 11 ? 80 : Math.min(4.6 * k, 46)) }),
    )
    const l = lines(pressOf({ frames }))
    expect(l.reorders!.ok).toBe(true)
    expect(l.reorders!.text).toContain("dropped 1 slot from the nearest")
  })

  it("L11: no item at the pointer (the dragged item clipped by its container) isn't a miss; a sibling there is", () => {
    const frames = Array.from({ length: 12 }, (_, k) =>
      frameOf(k >= 8 ? AFTER : VALUES, { dragged: "b", paint: moved(slot(1), Math.min(4.6 * k, 46)), hit: k >= 9 ? null : "b" }),
    )
    expect(reorderRunOf(pressOf({ frames }))!.raisedMisses).toBe(0)
    expect(lines(pressOf({ frames })).raised!.ok).toBe(true)
  })

  it("L10: with the pointer never inside the dragged item, raised has nothing to judge", () => {
    const frames = Array.from({ length: 12 }, (_, k) =>
      frameOf(k >= 8 ? AFTER : VALUES, { dragged: "b", paint: moved(slot(1), Math.min(4.6 * k, 46)), inDragged: false }),
    )
    const l = lines(pressOf({ frames }))
    expect(l.raised).toEqual({ name: "raised", ok: true, text: "? · the pointer never covered it" })
  })
})

describe("the lift line (#47, scenario 14's Lift)", () => {
  /** b painted at its grab slot scaled by `r` about its centre, `dy` below. */
  const scaled = (r: number, dy = 0): Box => {
    const s = slot(1)
    return { x: s.x - (s.width * (r - 1)) / 2, y: s.y + dy - (s.height * (r - 1)) / 2, width: s.width * r, height: s.height * r }
  }
  /** A press of b with Lift at `lift` (absent: off): `held` ratios while held, `after` ratios once released. */
  const liftRun = (held: ReadonlyArray<number>, after: ReadonlyArray<number>, lift?: number): DragRunInput => {
    const base = pressOf()
    const ratios = [...held, ...after]
    const frames: Array<DragFrame> = ratios.map((r, i) => {
      const reorder = frameOf(VALUES, { dragged: "b", paint: scaled(r, i < held.length ? 4 * i : 4 * held.length) })
      return { frame: i + 1, frameAt: 16 * (i + 1), t: 16 * (i + 1) + 4, d: reorder.items.b!, slot: slot(1), children: {}, reorder }
    })
    const moves = Array.from({ length: held.length }, (_, k): DragMove => ({ t: 8 + 16 * k, frame: k, dx: 0, dy: 4 * (k + 1), buttons: 1 }))
    return {
      ...base,
      moves,
      frames,
      releaseAt: 16 * (held.length + 1) - 4,
      endedAt: 16 * (ratios.length + 1),
      reorder: { ...base.reorder!, reorders: [], ...(lift !== undefined ? { lift } : {}) },
    }
  }
  const liftLine = (input: DragRunInput) => reorderChecksOf(input, EXPECT).find((c) => c.name === "lift")

  it("L12: with Lift off, the line says so and judges nothing", () => {
    expect(liftLine(liftRun([1, 1, 1, 1], [1, 1]))).toEqual({ name: "lift", ok: true, text: "lift off" })
  })

  it("L13: a lift from 1 to 1.05 that lands back at 1 passes", () => {
    const line = liftLine(liftRun([1, 1, 1.01, 1.03, 1.045, 1.05, 1.05], [1.04, 1.02, 1.005, 1, 1], 1.05))
    expect(line).toEqual({ name: "lift", ok: true, text: "lowest 1.000 · held 1.050 · after 1.000 ✓" })
  })

  it("L14: a lift that grows from 0 fails (#47 before its fix)", () => {
    const line = liftLine(liftRun([1, 0.12, 0.35, 0.7, 0.95, 1.05, 1.05], [1.05, 1.05, 1.05], 1.05))
    expect(line?.ok).toBe(false)
    expect(line?.text).toBe("lowest 0.120 · held 1.050 · after 1.050 ✗ expected lowest ≥ 0.99 · held 1.05 · after 1")
  })

  it("L15: a lift that never lands back at 1 fails", () => {
    const line = liftLine(liftRun([1, 1, 1.03, 1.05, 1.05], [1.05, 1.05, 1.05], 1.05))
    expect(line?.ok).toBe(false)
    expect(line?.text).toMatch(/after 1\.050 ✗/)
  })

  it("L16: a press that never moves past the threshold reads click, as every line does", () => {
    const run = liftRun([1], [1], 1.05)
    const click = { ...run, moves: [{ t: 8, frame: 0, dx: 1, dy: 1, buttons: 1 }] }
    expect(liftLine(click)).toEqual({ name: "lift", ok: true, text: "click, no drag" })
  })

  // #142: a rapid re-grab's press is shorter than the lift's spring takes to land (about 0.4 s).
  /** `n` held frames rising toward `top` (16 ms each: the lift runs 16·n − 4 ms from the drag's start). */
  const rising = (n: number, top: number): Array<number> => Array.from({ length: n }, (_, k) => 1 + (top - 1) * Math.min(1, k / 6))

  it("L17: a press too short for the lift to land isn't judged on held, and says so (#142)", () => {
    // 7 held frames: the lift ran 116 ms, reaching 1.02.
    const line = liftLine(liftRun(rising(7, 1.02), [1.01, 1.005, 1, 1], 1.05))
    expect(line).toEqual({ name: "lift", ok: true, text: "lowest 1.000 · held 1.020 (116 ms: too short for the lift to land, not judged) · after 1.000 ✓" })
  })

  it("L18: a short press that reached the lift is judged on it; a long one that never did fails (#142)", () => {
    expect(liftLine(liftRun([1, 1.02, 1.045, 1.05, 1.05], [1.02, 1, 1], 1.05))?.text).toBe("lowest 1.000 · held 1.050 · after 1.000 ✓")
    // 26 held frames, 420 ms, stalled at 1.03.
    const stalled = liftLine(liftRun(rising(26, 1.03), [1.01, 1, 1], 1.05))
    expect(stalled?.ok).toBe(false)
    expect(stalled?.text).toBe("lowest 1.000 · held 1.030 · after 1.000 ✗ expected lowest ≥ 0.99 · held 1.05 · after 1")
  })

  it("L19: a short press's lowest is still judged: a lift that dips fails (#142)", () => {
    const line = liftLine(liftRun([1, 0.95, 1.01, 1.02], [1, 1], 1.05))
    expect(line?.ok).toBe(false)
    expect(line?.text).toMatch(/✗ expected lowest ≥ 0\.99 · after 1$/)
  })

  it("L20: a run the next press cut short isn't judged on after; one that settled mid-spring is (#142)", () => {
    const run = liftRun(rising(7, 1.02), [1.015, 1.012], 1.05)
    expect(liftLine({ ...run, endedBy: "next-press" })).toEqual({
      name: "lift",
      ok: true,
      text: "lowest 1.000 · held 1.020 (116 ms: too short for the lift to land, not judged) · after 1.012 (cut short, not judged) ✓",
    })
    expect(liftLine({ ...run, endedBy: "settled" })?.ok).toBe(false)
  })
})

// #42: the no stretch line. Item c's slot grows from 36 to 56 px tall at the reorder (variable
// sizes); with the items' layout `true` it paints from 36 up, with `"position"` at 56 at once.
describe("the no stretch line (#42, scenario 14's item layout)", () => {
  const NO_STRETCH = { ...EXPECT, noStretchMaxPx: 0.5 }
  /** A press of b with c growing in its new slot; c painted `cHeights[k]` tall in frame k after the reorder. */
  const growRun = (itemLayout: "position" | undefined, cHeights: ReadonlyArray<number>, lift?: number): DragRunInput => {
    const base = pressOf()
    const frames = base.frames.map((f, k) => {
      const r = f.reorder!
      if (k < 8) return f
      const height = cHeights[Math.min(k - 8, cHeights.length - 1)]!
      const slots = { ...r.slots, c: { ...r.slots.c!, height: 56 } }
      const items = { ...r.items, c: { ...r.items.c!, height } }
      return { ...f, reorder: { ...r, slots, items } }
    })
    return {
      ...base,
      frames,
      reorder: { ...base.reorder!, variableSizes: true, ...(itemLayout !== undefined ? { itemLayout } : {}), ...(lift !== undefined ? { lift } : {}) },
    }
  }
  const line = (input: DragRunInput) => reorderChecksOf(input, NO_STRETCH).find((c) => c.name === "no stretch")

  it("NS1: with position, items at their slot's size every frame pass", () => {
    expect(line(growRun("position", [56, 56, 56, 56]))).toEqual({ name: "no stretch", ok: true, text: "0.00 px · layout position · variable sizes ✓" })
  })

  it("NS2: with position, an item that scales from its old size fails", () => {
    const l = line(growRun("position", [36, 44, 52, 56]))
    expect(l?.ok).toBe(false)
    expect(l?.text).toBe("20.00 px · item c · layout position · variable sizes ✗ expected ≤ 0.5 px")
  })

  it("NS3: with true, the stretch is shown and not judged", () => {
    expect(line(growRun(undefined, [36, 44, 52, 56]))).toEqual({ name: "no stretch", ok: true, text: "20.00 px · item c · layout true · variable sizes, not judged" })
  })

  it("NS4: the dragged item is left out while Lift scales it", () => {
    const base = growRun("position", [56, 56, 56, 56], 1.05)
    const lifted = { ...base, frames: base.frames.map((f) => ({ ...f, reorder: { ...f.reorder!, items: { ...f.reorder!.items, b: { ...f.reorder!.items.b!, width: 189 } } } })) }
    expect(line(lifted)?.ok).toBe(true)
  })
})

// #43: a keyboard reorder's run (scenario 14's keyboard recorder): no pointer moves, its held
// frames from its lift (its grab) to its drop, and what the live region said.
describe("keyboard runs (#43, scenario 14)", () => {
  const SAID = ["Picked up b, position 2 of 6.", "b, position 3 of 6.", "Dropped b at position 3 of 6."]
  /** pressOf's run as a keyboard run: no moves, the lift at the grab, and its announcements. */
  const keyboardOf = (over: { readonly announced?: ReadonlyArray<string>; readonly focusKept?: boolean; readonly endedBy?: DragRunInput["endedBy"] } = {}): DragRunInput => {
    const base = pressOf()
    return {
      ...base,
      moves: [],
      ...(over.endedBy !== undefined ? { endedBy: over.endedBy } : {}),
      reorder: { ...base.reorder!, keyboard: { announced: over.announced ?? SAID, focusKept: over.focusKept ?? true } },
    }
  }

  it("KR1: a keyboard run is judged as a drag from its lift to its drop, and announces the lift first and the drop last, focus kept", () => {
    const l = lines(keyboardOf())
    expect(l.reorders).toEqual({ name: "reorders", ok: true, text: "1 · one place each · placed by keyboard ✓" })
    expect(l["uninvolved still"]).toEqual({ name: "uninvolved still", ok: true, text: "0.00 px · 4 items ✓" })
    expect(l.raised!.text).toMatch(/^\d+\/\d+ frames on top ✓$/)
    expect(l.announced).toEqual({
      name: "announced",
      ok: true,
      text: "“Picked up b, position 2 of 6.” · “b, position 3 of 6.” · “Dropped b at position 3 of 6.” ✓",
    })
  })

  it("KR2: announced fails with no lift first, no drop or cancel last, or focus that left the item; a run cut short isn't held to its end", () => {
    expect(lines(keyboardOf({ announced: SAID.slice(1) })).announced!.ok).toBe(false)
    expect(lines(keyboardOf({ announced: SAID.slice(0, 2) })).announced!.ok).toBe(false)
    expect(lines(keyboardOf({ announced: [SAID[0]!, "Cancelled. b is back at position 2 of 6."] })).announced!.ok).toBe(true)
    const left = lines(keyboardOf({ focusKept: false })).announced!
    expect(left.ok).toBe(false)
    expect(left.text).toContain("focus left the item")
    const cut = lines(keyboardOf({ announced: SAID.slice(0, 2), endedBy: "next-press" })).announced!
    expect(cut.ok).toBe(true)
    expect(cut.text).toContain("cut short")
  })

  it("KR4: a cancel's restore of the order from the lift is no step: left out of reorders, which says it's back", () => {
    const base = keyboardOf({ announced: [SAID[0]!, SAID[1]!, "Cancelled. b is back at position 2 of 6."] })
    const restored = { ...base, reorder: { ...base.reorder!, reorders: [...base.reorder!.reorders, { t: 200, frame: 11, order: VALUES }] } }
    expect(lines(restored).reorders).toEqual({ name: "reorders", ok: true, text: "1 · one place each · cancelled: back where it was ✓" })
  })

  it("KR3: a pointer's run announces nothing, by design; a keyboard run's drag lines but ends on slot have no pointer to read", () => {
    expect(lines(pressOf()).announced).toEqual({ name: "announced", ok: true, text: "a pointer's run: nothing, by design" })
    const drag = dragChecksOf(dragRunOf(keyboardOf(), []), { endsOnSlotMaxPx: 0.5, underPointerMaxPx: 1 })
    for (const c of drag.filter((c) => c.name !== "ends on slot")) expect(c, c.name).toEqual({ name: c.name, ok: true, text: "a keyboard run: no pointer" })
    // Read as a drag's: this fixture has no frame after its release, so it reads `?`, as the pointer run's does.
    const end = drag.find((c) => c.name === "ends on slot")!
    expect(end.text).not.toBe("a keyboard run: no pointer")
    expect(end).toEqual(dragChecksOf(dragRunOf(pressOf(), []), { endsOnSlotMaxPx: 0.5, underPointerMaxPx: 1 }).find((c) => c.name === "ends on slot"))
  })
})
