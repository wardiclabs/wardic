/**
 * Issue #44's reorder runs: what scenario 14 adds to a drag run of a `<Reorder>` item,
 * and the card lines read from it. A reorder run is a drag run (`lab/drag-run.ts`:
 * under pointer, frames behind, passes, release held, ends on slot and gesture ends
 * judge the dragged item as they do any drag) whose input carries a
 * {@link ReorderRunData} and whose frames carry a {@link ReorderFrame} each.
 *
 * - **reorders**: how many reorders the press made, whether each moved the item one
 *   place (on a single axis the Crossover moves it to a neighbour, ADR-0020; a grid's
 *   move to another row can move it further), and where it was dropped: on the slot
 *   nearest its painted centre at the release, or how many slots from it. The drop is
 *   reported, not judged: a flick released while moving can let go past a neighbour's
 *   centre before the next reorder.
 * - **uninvolved still**: the items whose place in the order never changed during the
 *   press: the most any of them moved, painted, relative to the group (so a scroll of
 *   the container or the page, which moves the group with them, doesn't count). A leak
 *   of a resize (#39) or a scroll (D15) into a layout animation moves them.
 * - **raised**: on every held frame with the dragged item among the items at the pointer
 *   (`elementsFromPoint`), the topmost of them is the dragged one: it paints above its
 *   siblings (the engine's raise, D10). A frame with the item clipped by its scroll
 *   container at the pointer shows nothing about it.
 * - **auto-scrolled**: how far the scroller moved during the press, past what the S key
 *   scrolled by hand (Auto-scroll, D16). Reported, not judged.
 *
 * Pure (no DOM), so the node test tier imports it (`test/reorder-run.test.ts`).
 *
 * @module
 */
import type { Box, DragRunInput, Point } from "./drag-run.ts"

/** The drag recognizer's threshold, in px (as `lab/drag-run.ts`). */
const DRAG_THRESHOLD_PX = 3

/** What scenario 14 reads in each frame, after its paint. */
export interface ReorderFrame {
  /** Each item's painted box (transform included) relative to the group's box, by value. */
  readonly items: Readonly<Record<string, Box>>
  /** Each item's slot (its layout box, which transforms don't move) relative to the group, by value. */
  readonly slots: Readonly<Record<string, Box>>
  /** The value of the item under the pointer (`elementFromPoint`), `null` for none. */
  readonly hit: string | null
  /**
   * Whether the dragged item is among the items at the pointer (`elementsFromPoint`):
   * there to be hit, not clipped by its container there. Then `hit` is it, or the
   * sibling painted above it.
   */
  readonly pointerInDragged: boolean
}

/** One reorder (`onReorder`) during a press. */
export interface ReorderEvent {
  /** When `onReorder` ran (`performance.now()`, ms). */
  readonly t: number
  /** The recorder's frame counter then. */
  readonly frame: number
  /** The new order. */
  readonly order: ReadonlyArray<string>
}

/** What scenario 14 adds to a press's drag run input. */
export interface ReorderRunData {
  /** The scenario's layout mode at the grab (`y`, `x`, `xy`, `rtl`, `row-reverse`, `column-reverse`). */
  readonly layout: string
  /** The group's axis at the grab (`x`, `y` or `xy`). */
  readonly axis: string
  /** The dragged item's value. */
  readonly dragged: string
  /** The order at the grab. */
  readonly orderAtGrab: ReadonlyArray<string>
  /** Every reorder during the press, oldest first. */
  readonly reorders: ReadonlyArray<ReorderEvent>
  /** The scroller's (container's or page's) scroll at the grab and when the recorder stopped, px. */
  readonly scrollAtGrab: Point
  readonly scrollAtEnd: Point
  /** How far the S key scrolled it during the press, px. */
  readonly scrolledByHand: Point
}

/** What a reorder scenario expects of every press (see {@link reorderChecksOf}). */
export interface ReorderExpect {
  /** On a single axis, every reorder moves the item one place. */
  readonly oneStep?: boolean
  /** The most {@link ReorderRun.uninvolvedMaxPx} may read, in px. */
  readonly uninvolvedMaxPx?: number
  /** The dragged item is the one at the pointer on every held frame it covers the pointer. */
  readonly raised?: boolean
}

/** What {@link reorderRunOf} reads from a press. */
export interface ReorderRun {
  readonly reorderCount: number
  /** How many places each reorder moved the dragged item, oldest first. */
  readonly steps: ReadonlyArray<number>
  /** How many slots the drop was from the slot nearest the item's painted centre at the release; `null` with no frame to read. */
  readonly dropFromNearest: number | null
  /** The items whose place never changed during the press. */
  readonly uninvolved: ReadonlyArray<string>
  /** The most any of them moved, painted, relative to the group, in px. */
  readonly uninvolvedMaxPx: number
  /** The held frames with the pointer inside the dragged item and an item at the pointer. */
  readonly raisedFrames: number
  /** How many of them had another item (or nothing) at the pointer. */
  readonly raisedMisses: number
  /** How far the scroller moved during the press past the S key's scrolls, in px (the larger axis). */
  readonly autoScrolledPx: number
}

/** The card's reorder lines, in display order. */
export const REORDER_CHECK_NAMES = ["reorders", "uninvolved still", "raised", "auto-scrolled"] as const

/** One of {@link REORDER_CHECK_NAMES}. */
export type ReorderCheckName = (typeof REORDER_CHECK_NAMES)[number]

/** One card line (as a drag run's `DragCheck`). */
export interface ReorderCheck {
  readonly name: ReorderCheckName
  readonly ok: boolean
  readonly text: string
}

const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const boxDistance = (a: Box, b: Box): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
const px = (n: number): string => `${n.toFixed(2)} px`

/** A press's reorder data and its frames' reorder reads, or `undefined` for a run with none. */
const dataOf = (input: DragRunInput): ReorderRunData | undefined => input.reorder

/**
 * Reads a {@link ReorderRun} from a drag run input that carries reorder data, or
 * `undefined` for one that doesn't (another scenario's).
 */
export const reorderRunOf = (input: DragRunInput): ReorderRun | undefined => {
  const data = dataOf(input)
  if (data === undefined) return undefined
  const frames = input.frames.filter((f) => f.reorder !== undefined)

  // The places each reorder moved the dragged item.
  const steps: Array<number> = []
  let before = data.orderAtGrab
  for (const r of data.reorders) {
    steps.push(Math.abs(r.order.indexOf(data.dragged) - before.indexOf(data.dragged)))
    before = r.order
  }

  // The items whose place never changed.
  const orders = [data.orderAtGrab, ...data.reorders.map((r) => r.order)]
  const uninvolved = data.orderAtGrab.filter(
    (v) => v !== data.dragged && orders.every((o) => o.indexOf(v) === data.orderAtGrab.indexOf(v)),
  )
  let uninvolvedMaxPx = 0
  const first = frames[0]?.reorder
  if (first !== undefined) {
    for (const f of frames) {
      for (const v of uninvolved) {
        const a = first.items[v]
        const b = f.reorder!.items[v]
        if (a !== undefined && b !== undefined) uninvolvedMaxPx = Math.max(uninvolvedMaxPx, boxDistance(a, b))
      }
    }
  }

  // The held frames: after the drag's first move past the threshold, before the release.
  const start = input.moves.find((m) => Math.hypot(m.dx, m.dy) > DRAG_THRESHOLD_PX)
  const held =
    start === undefined
      ? []
      : frames.filter((f) => f.frame > start.frame && (input.releaseAt === null || f.frameAt < input.releaseAt))
  // A frame with no item at the pointer (the dragged item clipped by its container) shows
  // nothing about the raise; one with a sibling there shows the item under it.
  const covering = held.filter((f) => f.reorder!.pointerInDragged && f.reorder!.hit !== null)
  const raisedMisses = covering.filter((f) => f.reorder!.hit !== data.dragged).length

  // The drop: at the last held frame, the slot nearest the dragged item's painted centre.
  let dropFromNearest: number | null = null
  const last = held[held.length - 1]?.reorder
  const finalOrder = data.reorders[data.reorders.length - 1]?.order ?? data.orderAtGrab
  if (last !== undefined && last.items[data.dragged] !== undefined) {
    const c = centreOf(last.items[data.dragged]!)
    let nearest: string | undefined
    let best = Number.POSITIVE_INFINITY
    for (const [v, slot] of Object.entries(last.slots)) {
      const s = centreOf(slot)
      const d = Math.hypot(s.x - c.x, s.y - c.y)
      if (d < best) {
        best = d
        nearest = v
      }
    }
    // The nearest slot's value holds that place in the final order: the drop is that many places from it.
    if (nearest !== undefined) {
      const lastOrder = orderAt(data, held[held.length - 1]!.frame)
      dropFromNearest = Math.abs(finalOrder.indexOf(data.dragged) - lastOrder.indexOf(nearest))
    }
  }

  const moved = {
    x: data.scrollAtEnd.x - data.scrollAtGrab.x - data.scrolledByHand.x,
    y: data.scrollAtEnd.y - data.scrollAtGrab.y - data.scrolledByHand.y,
  }
  return {
    reorderCount: data.reorders.length,
    steps,
    dropFromNearest,
    uninvolved,
    uninvolvedMaxPx,
    raisedFrames: covering.length,
    raisedMisses,
    autoScrolledPx: Math.max(Math.abs(moved.x), Math.abs(moved.y)),
  }
}

/** The order the slots of frame `frame` were laid out in: the newest reorder at or before it. */
const orderAt = (data: ReorderRunData, frame: number): ReadonlyArray<string> => {
  let order = data.orderAtGrab
  for (const r of data.reorders) if (r.frame < frame) order = r.order
  return order
}

/** One line: the value alone with no expectation, `value ✓` when it holds, `value ✗ expected …` when not. */
const lineOf = (name: ReorderCheckName, value: string, expected: string | undefined, ok: boolean): ReorderCheck => {
  if (expected === undefined) return { name, ok: true, text: value }
  return { name, ok, text: ok ? `${value} ✓` : `${value} ✗ expected ${expected}` }
}

/** Every reorder line of a press that never moved past the drag threshold. */
const CLICK_TEXT = "click, no drag"

/**
 * Checks a reorder run against `expect`: one {@link ReorderCheck} per name in
 * {@link REORDER_CHECK_NAMES}. A press with no move past the drag threshold is a
 * click, and every line reads `click, no drag`. A run with no reorder data has no
 * lines.
 */
export const reorderChecksOf = (input: DragRunInput, expect: ReorderExpect): Array<ReorderCheck> => {
  const run = reorderRunOf(input)
  const data = dataOf(input)
  if (run === undefined || data === undefined) return []
  if (input.moves.find((m) => Math.hypot(m.dx, m.dy) > DRAG_THRESHOLD_PX) === undefined) {
    return REORDER_CHECK_NAMES.map((name) => ({ name, ok: true, text: CLICK_TEXT }))
  }
  const singleAxis = data.axis !== "xy"
  const oneStep = run.steps.every((s) => s === 1)
  const drop =
    run.dropFromNearest === null
      ? "drop ?"
      : run.dropFromNearest === 0
        ? "dropped on the nearest slot"
        : `dropped ${run.dropFromNearest} slot${run.dropFromNearest === 1 ? "" : "s"} from the nearest`
  const steps = run.reorderCount === 0 ? "" : ` · ${oneStep ? "one place each" : `places ${run.steps.join(", ")}`}`
  const judgeSteps = expect.oneStep === true && singleAxis
  return [
    lineOf(
      "reorders",
      `${run.reorderCount}${steps} · ${drop}`,
      judgeSteps ? "one place each" : undefined,
      !judgeSteps || oneStep,
    ),
    lineOf(
      "uninvolved still",
      run.uninvolved.length === 0 ? "none uninvolved" : `${px(run.uninvolvedMaxPx)} · ${run.uninvolved.length} item${run.uninvolved.length === 1 ? "" : "s"}`,
      expect.uninvolvedMaxPx === undefined || run.uninvolved.length === 0 ? undefined : `≤ ${expect.uninvolvedMaxPx} px`,
      expect.uninvolvedMaxPx === undefined || run.uninvolvedMaxPx <= expect.uninvolvedMaxPx,
    ),
    lineOf(
      "raised",
      run.raisedFrames === 0
        ? "? · the pointer never covered it"
        : `${run.raisedFrames - run.raisedMisses}/${run.raisedFrames} frames on top`,
      expect.raised === true && run.raisedFrames > 0 ? "every frame" : undefined,
      run.raisedMisses === 0,
    ),
    lineOf("auto-scrolled", px(run.autoScrolledPx), undefined, true),
  ]
}
