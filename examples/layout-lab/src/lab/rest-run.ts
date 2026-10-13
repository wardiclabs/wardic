/**
 * An at-rest run (#144, ADR-0013 *Amendment (#144)*): a layout change made while the item is at
 * rest (scenario 12's X moves its slot), recorded by the drag recorder's frame sampler from the
 * change until everything has stood still. Each frame records the item's painted box and its
 * slot, the painted box of each glued element (which should ride the item through its layout
 * animation), and the painted and layout box of each isolated element (a `layoutRoot` and what's
 * inside it, which should sit at its new place from the first frame, ADR-0013 *Amendment (#33)*).
 *
 * The card judges it on four lines: how far the `slot moved`, whether the item `ends on slot`,
 * whether each glued element stayed `child glued`, and whether each isolated element stayed
 * `isolated`. A run the next press or change cut short was still settling, so `ends on slot`
 * isn't judged then; the other lines judge every frame recorded.
 *
 * Pure, with no DOM read, so the node test tier covers it.
 *
 * @module
 */
import type { Box, Point } from "./drag-run.ts"

/** One frame of an at-rest run, read after its paint, every box relative to the stage. */
export interface RestFrame {
  /** The recorder's frame counter at this frame's rAF callback. */
  readonly frame: number
  /** When that rAF callback ran (`performance.now()`). */
  readonly frameAt: number
  /** When the frame was read, after its paint. */
  readonly t: number
  /** The item's painted box (its transform included). */
  readonly d: Box
  /** The item's slot: its layout box, which transforms don't move. */
  readonly slot: Box
  /** Each glued element's painted box, by name. */
  readonly glued: Readonly<Record<string, Box>>
  /** Each isolated element's painted box and its layout box (its new place), by name. */
  readonly isolated: Readonly<Record<string, { readonly painted: Box; readonly layout: Box }>>
}

/** Why an at-rest run ended: everything stood still, its time ran out, a press or a new change cut it short, or the item left the page. */
export type RestRunEnd = "settled" | "timeout" | "next-press" | "next-change" | "removed"

/** What the recorder hands `ctx.recordRestRun` for one change at rest. */
export interface RestRunInput {
  /** Filled in by the lab: the scenario whose context recorded it. */
  readonly scenarioId: string
  /** What made the change (scenario 12: `X`). */
  readonly trigger: string
  /** When the change was made (`performance.now()`). */
  readonly startedAt: number
  /** The item's slot just before the change. */
  readonly slotBefore: Box
  /** Each glued element's offset from the item just before the change, by name. */
  readonly gluedOffsets: Readonly<Record<string, Point>>
  /**
   * Glued elements the scenario left out of this run, with why (scenario 12's M while its own
   * slide from a grab may still run: its offset then changes by design).
   */
  readonly leftOut?: Readonly<Record<string, string>>
  /** The frames read after the change, oldest first. */
  readonly frames: ReadonlyArray<RestFrame>
  /** When the run ended (`performance.now()`). */
  readonly endedAt: number
  readonly endedBy: RestRunEnd
  /** The lab's scheduler mode during the run. */
  readonly scheduler: "default" | "microtask"
}

/** An at-rest run with what the card reads from it. */
export interface RestRun extends RestRunInput {
  /** How far the slot moved: from {@link RestRunInput.slotBefore} to the last frame's slot, in px. */
  readonly slotMoved: Point | null
  /** The last frame's box against its slot (`boxDistance`); `null` with no frame. */
  readonly endsOnSlotPx: number | null
  /** Each glued element's largest drift from its offset before the change, over every frame, in px. */
  readonly childGlueMaxPx: Readonly<Record<string, number>>
  /** Each isolated element's largest distance from its layout box, over every frame, in px. */
  readonly isolatedMaxPx: Readonly<Record<string, number>>
}

/** What a scenario expects of its at-rest runs (`restExpect`); a bound left out shows its value with no check. */
export interface RestExpect {
  /** The most the item may end off its slot, in px. */
  readonly endsOnSlotMaxPx?: number
  /** The most any glued element may drift from its offset, in px. */
  readonly childGlueMaxPx?: number
  /** The most any isolated element may be off its new place, in px. */
  readonly isolatedMaxPx?: number
}

/** The at-rest card's lines, in order. */
export const REST_CHECK_NAMES = ["slot moved", "ends on slot", "child glued", "isolated"] as const

/** One of {@link REST_CHECK_NAMES}. */
export type RestCheckName = (typeof REST_CHECK_NAMES)[number]

/** One card line. */
export interface RestCheck {
  readonly name: RestCheckName
  readonly ok: boolean
  readonly text: string
}

/** The larger of the x and y distances between two points (the drag run's `pointDistance`). */
const pointDistance = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** The largest absolute difference over `x`, `y`, `width` and `height` (the drag run's `boxDistance`). */
const boxDistance = (a: Box, b: Box): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height))

/** Each name's largest `read(frame, name)` over `frames`, for the names `names` lists. */
const maxPerName = (
  names: ReadonlyArray<string>,
  frames: ReadonlyArray<RestFrame>,
  read: (frame: RestFrame, name: string) => number | undefined,
): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const name of names) {
    let max: number | undefined
    for (const f of frames) {
      const v = read(f, name)
      if (v !== undefined) max = max === undefined ? v : Math.max(max, v)
    }
    if (max !== undefined) out[name] = max
  }
  return out
}

/** Reads what the card judges from an at-rest run's frames. */
export const restRunOf = (input: RestRunInput): RestRun => {
  const last = input.frames[input.frames.length - 1]
  const isolatedNames = [...new Set(input.frames.flatMap((f) => Object.keys(f.isolated)))]
  return {
    ...input,
    slotMoved: last === undefined ? null : { x: last.slot.x - input.slotBefore.x, y: last.slot.y - input.slotBefore.y },
    endsOnSlotPx: last === undefined ? null : boxDistance(last.d, last.slot),
    childGlueMaxPx: maxPerName(Object.keys(input.gluedOffsets), input.frames, (f, name) => {
      const child = f.glued[name]
      const offset = input.gluedOffsets[name]
      if (child === undefined || offset === undefined) return undefined
      return pointDistance({ x: child.x - f.d.x, y: child.y - f.d.y }, offset)
    }),
    isolatedMaxPx: maxPerName(isolatedNames, input.frames, (f, name) => {
      const at = f.isolated[name]
      return at === undefined ? undefined : boxDistance(at.painted, at.layout)
    }),
  }
}

const px = (n: number): string => `${n.toFixed(2)} px`

/** One card line: the value alone with no expectation, `value ✓` when it holds, `value ✗ expected …` when not. */
const lineOf = (name: RestCheckName, value: string, expected: string | undefined, ok: boolean): RestCheck => {
  if (expected === undefined) return { name, ok: true, text: value }
  return { name, ok, text: ok ? `${value} ✓` : `${value} ✗ expected ${expected}` }
}

/** Each name's value, `c1 0.00 · m 5.62 px`, or `?` with none. */
const perName = (values: ReadonlyArray<readonly [string, number]>): string =>
  values.length === 0 ? "?" : `${values.map(([name, v]) => `${name} ${v.toFixed(2)}`).join(" · ")} px`

/** The glued elements left out, `· m left out (its own slide from a grab)`, or nothing. */
const leftOutText = (leftOut: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(leftOut ?? {})
    .map(([name, why]) => ` · ${name} left out (${why})`)
    .join("")

/** What cut a run short, for the `ends on slot` line. */
const CUT_TEXT: Partial<Record<RestRunEnd, string>> = {
  "next-press": "cut short by a press",
  "next-change": "cut short by the next change",
  removed: "cut short: the item left the page",
}

/** The card's lines for an at-rest run, against the scenario's `restExpect`. */
export const restChecksOf = (run: RestRun, expect: RestExpect): Array<RestCheck> => {
  const glue = Object.entries(run.childGlueMaxPx)
  const isolated = Object.entries(run.isolatedMaxPx)
  const { endsOnSlotMaxPx: slotMax, childGlueMaxPx: glueMax, isolatedMaxPx: isolatedMax } = expect
  const moved = run.slotMoved
  const cut = CUT_TEXT[run.endedBy]
  return [
    lineOf(
      "slot moved",
      `${run.trigger} · ${moved === null ? "?" : `${moved.x.toFixed(1)}, ${moved.y.toFixed(1)} px`} · ${run.frames.length} frames`,
      undefined,
      true,
    ),
    cut === undefined
      ? lineOf(
          "ends on slot",
          run.endsOnSlotPx === null ? "?" : px(run.endsOnSlotPx),
          slotMax === undefined ? undefined : `≤ ${slotMax} px`,
          run.endsOnSlotPx !== null && slotMax !== undefined && run.endsOnSlotPx <= slotMax,
        )
      : lineOf("ends on slot", run.endsOnSlotPx === null ? cut : `${px(run.endsOnSlotPx)} · ${cut}`, undefined, true),
    lineOf(
      "child glued",
      `${perName(glue)}${leftOutText(run.leftOut)}`,
      glueMax === undefined ? undefined : `≤ ${glueMax} px`,
      glue.length > 0 && glueMax !== undefined && glue.every(([, v]) => v <= glueMax),
    ),
    lineOf(
      "isolated",
      perName(isolated),
      isolatedMax === undefined ? undefined : `≤ ${isolatedMax} px`,
      isolated.length > 0 && isolatedMax !== undefined && isolated.every(([, v]) => v <= isolatedMax),
    ),
  ]
}
