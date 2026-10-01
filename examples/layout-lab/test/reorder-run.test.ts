// Issue #44's reorder runs (`reorderRunOf`, `reorderChecksOf`), in the node test tier.
// The fixtures are small inputs shaped like scenario 14's runs: a y list of six 180x36
// items 8px apart (a 44px pitch), b grabbed at its centre and dragged 46px down past c.
// The recorder's first rAF after the grab is frame 1, frames are 16 ms apart, and each
// move is handled between one frame's paint and the next frame's rAF.
import { describe, expect, it } from "vitest"
import type { Box, DragFrame, DragMove, DragRunInput } from "../src/lab/drag-run.ts"
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
