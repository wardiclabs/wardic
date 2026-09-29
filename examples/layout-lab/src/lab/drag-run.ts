/**
 * Issue #26's drag runs: what one hand-driven drag of a `kind: "drag"` scenario
 * recorded (a {@link DragRunInput}), and what the lab reads from it (a
 * {@link DragRun}): whether the dragged element stayed under the pointer, how many
 * painted frames it lagged a pointer move, whether its children stayed glued to it,
 * which Measure passes ran during the drag and what they seeded and drag-blocked,
 * how many frames the release held, and whether it ended on its slot.
 *
 * A drag has no trigger. It is one press: the grab (the pointerdown), the moves,
 * the release (the pointerup), and the frames after it until the element settles.
 * The scenario's recorder listens to the pointer without driving the drag
 * (`@wardic/solid`'s `drag` does that). It counts its own Refresh frames in its own
 * rAF callback and samples each frame after its paint: the dragged element's
 * painted box (`d`, `getBoundingClientRect`, so the projection transform is
 * included), its untransformed layout box (`slot`, from `offsetLeft`, `offsetTop`,
 * `offsetWidth` and `offsetHeight`) and its children's painted boxes, all relative
 * to the stage. It hands the lab one input per press through `ctx.recordDragRun`,
 * and the lab adds the `wardic.*` spans that started in `[grabAt, endedAt]`.
 *
 * Every move and every frame carries the recorder's frame counter, so which moves a
 * frame could show is exact: a move handled before a frame's rAF callback has a
 * smaller counter than that frame. No timestamp is compared there, because Firefox
 * coarsens `performance.now()` to whole milliseconds.
 *
 * The engine annotates each Measure pass with `seeded` (the nodes that started or
 * restarted a layout animation in the pass) and `dragBlocked` (the nodes in a
 * dragged subtree, the dragged node included, whose box changed in the pass: the
 * slot-only updates of a Drag block, ADR-0016 *Amendment (#26)*). Both are on every
 * pass, 0 when nothing applies. The lab copies a span's attributes when it ends
 * (`probe/timeline.ts`), so a span still in flight reads `{}`; that span, and one
 * from before #26's fix (no `dragBlocked`), count 0 for both.
 *
 * Pure (no DOM), so the node test tier imports it (`test/drag-run.test.ts`).
 *
 * @module
 */
import type { SpanRecord } from "../probe/timeline.ts"

/** The span that marks one Measure pass. */
const MEASURE_SPAN = "wardic.projection.measure"

/**
 * How far the pointer must move from where it went down before the drag starts, in
 * px: `THRESHOLD` in `packages/core/src/recognizers/drag.ts` (more than 3px,
 * straight-line). A move within it moves nothing, so it is not one of the drag's
 * moves.
 */
const DRAG_THRESHOLD_PX = 3

/** The "same place" distance, in px: a painted centre within it of a target shows that target. */
const NEAR_PX = 1

/**
 * How far the painted box must change for a frame after the release to count as
 * moved, in px. Much finer than {@link NEAR_PX}: a release's first step is a few
 * percent of its travel (a click's 192px FLIP starts with 5.1px), so a short release
 * would otherwise read as held. A held frame paints the same transform, so its box
 * is the same to well within this.
 */
const MOVED_PX = 0.01

/** A box relative to the stage, in CSS px. Plain numbers, so it is JSON-safe. */
export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A point or an offset, in CSS px. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** One pointer move the recorder handled while the item was pressed. */
export interface DragMove {
  /** When the move was handled (`performance.now()`, ms). */
  readonly t: number
  /**
   * The recorder's frame counter when the move was handled. The counter goes up in
   * the recorder's rAF callback, so the move can first show in the frame numbered
   * one higher.
   */
  readonly frame: number
  /** The pointer's horizontal offset from where it went down, in px. */
  readonly dx: number
  /** The pointer's vertical offset from where it went down, in px. */
  readonly dy: number
}

/** One frame, read after its paint. */
export interface DragFrame {
  /** The recorder's frame counter, as its rAF callback for this frame left it. */
  readonly frame: number
  /** When that rAF callback ran (`performance.now()`, ms). */
  readonly frameAt: number
  /** When the post-paint read ran (ms). */
  readonly t: number
  /** The dragged element's painted box (transform included). */
  readonly d: Box
  /** The dragged element's layout box, which transforms don't move: its slot. */
  readonly slot: Box
  /** Each watched child's painted box, by name. A child missing from a frame is not judged in it. */
  readonly children: Readonly<Record<string, Box>>
  /** Painted opacities, by name, for a scenario that watches them (a dragged `layoutId` lead). */
  readonly opacity?: Readonly<Record<string, number>>
}

/**
 * What a drag scenario's recorder hands `ctx.recordDragRun` for one press. Every
 * field is a number, string, plain object or array, so it survives a JSON round
 * trip unchanged.
 */
export interface DragRunInput {
  /** The scenario the run belongs to. The lab replaces it with its context's id. */
  readonly scenarioId: string
  /** The scenario's mode at the grab (scenario 11: `resize` or `reorder`). */
  readonly mode: string
  /** When the pointer went down on the drag handle (`performance.now()`, ms). */
  readonly grabAt: number
  /** The dragged element's painted box at the grab. */
  readonly grabBox: Box
  /** The pointer moves while pressed, oldest first. */
  readonly moves: ReadonlyArray<DragMove>
  /** One sample per frame painted after the grab, oldest first, through the settle after the release. */
  readonly frames: ReadonlyArray<DragFrame>
  /** Each watched child's painted offset from the dragged element at the grab, by name. */
  readonly childOffsets: Readonly<Record<string, Point>>
  /** When the pointer went up (ms), or `null` when the press never ended in a release. */
  readonly releaseAt: number | null
  /** When the recorder stopped (ms). */
  readonly endedAt: number
  /**
   * Whether a pointer event of the press landed outside the dragged element (a move
   * too fast for it, or the release). Wardic's drag listens on the element itself, so
   * from there it stops following and a release outside doesn't end it: the run then
   * shows that, not the Measure pass. Left out when it never happened.
   */
  readonly pointerLeft?: boolean
  /**
   * Effect's scheduler on the page (`currentLabScheduler()`): `default` is a browser's
   * own (`setTimeout(0)`, as no browser has `setImmediate`), `microtask` the browser
   * test harness's `queueMicrotask`-backed one (`?scheduler=microtask`). Pointer input
   * reaches Wardic's drag through one scheduler hop, so it is one frame later with
   * `default`. Left out, `default`.
   */
  readonly scheduler?: "default" | "microtask"
}

/** One Measure pass that started during a drag run. */
export interface DragPass {
  /** When the pass started (`performance.now()`, ms). */
  readonly start: number
  /** Its `seeded` attribute: the nodes it started or restarted a layout animation on (0 when absent). */
  readonly seeded: number
  /** Its `dragBlocked` attribute: the nodes it gave a slot-only update in a dragged subtree (0 when absent). */
  readonly dragBlocked: number
}

/** A drag run's Measure passes (see {@link formatDragPasses}). */
export interface DragPasses {
  /** How many Measure passes started in `[grabAt, endedAt]`. */
  readonly count: number
  /** How many of them seeded at least one node. */
  readonly seeding: number
  /** The sum of `dragBlocked` over them. */
  readonly dragBlocked: number
  /** Each of them, oldest first. */
  readonly perPass: ReadonlyArray<DragPass>
}

/**
 * One drag run: its {@link DragRunInput}, kept whole so a saved log carries the
 * evidence behind every number, plus what {@link dragRunOf} read from it. Every
 * field is JSON-safe (a missing value is `null`, never `undefined`).
 *
 * "Held" here means the item was held: a held frame is one painted after the
 * drag's first move and before the release (its rAF callback ran before
 * `releaseAt`), and a held pass is one that started at or after the grab and before
 * the release. `releaseHeld` is the other sense, as in the trigger cards' `held`:
 * frames the release sat still.
 */
export interface DragRun extends DragRunInput {
  /** How many held frames there were. */
  readonly heldFrameCount: number
  /**
   * The largest distance, in px (the larger of x and y), between a held frame's
   * painted centre and the grab box's centre moved by the latest pointer move
   * handled before that frame's rAF callback (with the `default` scheduler, before
   * the previous frame's: the input's hop, see {@link DragRunInput.scheduler}). Centres, so a slot resize mid-drag,
   * which paints the new size about the same centre (ADR-0016 *Amendment (#26)*),
   * reads 0. 0 with no held frame.
   */
  readonly underPointerMaxPx: number
  /**
   * The most painted frames any move took to show: for each move, the held frames
   * after it until one's painted centre is within 1px of where the move put it (or
   * of where a later move did). A move that the next one replaced before any frame
   * could show it is skipped, as is one no held frame came after (the release came
   * first). `null` when no move was measured. A move less than 1px from the one
   * before it reads 0 even when the element lags, so the lag shows on the faster
   * moves.
   */
  readonly framesBehindMax: number | null
  /** How many moves {@link framesBehindMax} measured. */
  readonly framesBehindMoves: number
  /**
   * For each child in `childOffsets`, the largest distance, in px (the larger of x and
   * y), between its painted offset from the dragged element and its grab-time offset,
   * over every frame of the run (held, released and settling). A child never sampled
   * is left out.
   */
  readonly childGlueMaxPx: Readonly<Record<string, number>>
  /** The `wardic.projection.measure` spans that started in `[grabAt, endedAt]`. */
  readonly passes: DragPasses
  /**
   * Frames painted after the release (rAF callback at or after `releaseAt`) that
   * still showed the held box (the last frame painted before the release), up to the
   * first that moved. A release from a task moves on its first painted frame: 0. A
   * release that had nowhere to go (the held box already within 1px of the slot)
   * also reads 0. `null` with no release, no frame on either side of it, or when
   * nothing moved although the held box was off the slot (stuck, the F2 case).
   * `>=` on `releaseAt`: a frame in the release's own millisecond (Firefox's coarse
   * timer) counts as after it, since the pointer's event is handled before the
   * frame's rAF callbacks.
   */
  readonly releaseHeld: number | null
  /**
   * The distance between the last frame's painted box and its slot, in px (the
   * largest difference over x, y, width and height). `null` with no release or no
   * frame after it.
   */
  readonly endsOnSlotPx: number | null
  /** The recorded `wardic.*` spans that started in `[grabAt, endedAt]`, as the lab joined them. */
  readonly spans: ReadonlyArray<SpanRecord>
}

/**
 * What a drag scenario expects of every drag run, which the card checks each run
 * against (see {@link dragChecksOf}). A bound left out is shown without a check.
 */
/** An expectation that depends on Effect's scheduler (see {@link DragRunInput.scheduler}). */
export type PerScheduler = number | { readonly default: number; readonly microtask: number }

/** `value` for the run's scheduler. */
const forScheduler = (value: PerScheduler | undefined, run: DragRunInput): number | undefined =>
  value === undefined || typeof value === "number" ? value : value[run.scheduler ?? "default"]

export interface DragExpect {
  /** The most {@link DragRun.underPointerMaxPx} may read, in px. */
  readonly underPointerMaxPx?: number
  /** The most {@link DragRun.framesBehindMax} may read (per scheduler: the input's hop adds one with `default`). */
  readonly framesBehindMax?: PerScheduler
  /** The most any child's {@link DragRun.childGlueMaxPx} may read, in px. */
  readonly childGlueMaxPx?: number
  /**
   * The most nodes a held pass may seed. Given, the held passes must also have
   * drag-blocked at least one node between them: a pass during the drag moves the
   * dragged tree's slots without animating them (scenario 11: 1, the sibling only).
   */
  readonly maxSeededPerPass?: number
  /** The most {@link DragRun.releaseHeld} may read (per scheduler: the release's hop can add one with `default`). */
  readonly releaseHeldMax?: PerScheduler
  /** The most {@link DragRun.endsOnSlotPx} may read, in px. */
  readonly endsOnSlotMaxPx?: number
}

/** The card's drag lines, in display order. {@link dragChecksOf} returns one check per name. */
export const DRAG_CHECK_NAMES = [
  "under pointer",
  "frames behind",
  "child glued",
  "passes",
  "release held",
  "ends on slot",
] as const

/** One of {@link DRAG_CHECK_NAMES}. */
export type DragCheckName = (typeof DRAG_CHECK_NAMES)[number]

/**
 * One card line: its text, and whether it met the scenario's expectation (`true`
 * when there is none).
 */
export interface DragCheck {
  readonly name: DragCheckName
  readonly ok: boolean
  readonly text: string
}

/** A box's centre. */
const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/** The larger of the x and y distances between two points. */
const pointDistance = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** The largest absolute difference over `x`, `y`, `width` and `height` (the sampler's `boxDistance`). */
const boxDistance = (a: Box, b: Box): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height))

/** A numeric span attribute, or 0 when it is absent (a span still in flight, or a log from before #26). */
const countOf = (value: unknown): number => (typeof value === "number" ? value : 0)

/** The drag's moves: from the first one past {@link DRAG_THRESHOLD_PX}, which starts the drag, on. */
const dragMovesOf = (moves: ReadonlyArray<DragMove>): ReadonlyArray<DragMove> => {
  const start = moves.findIndex((m) => Math.hypot(m.dx, m.dy) > DRAG_THRESHOLD_PX)
  return start === -1 ? [] : moves.slice(start)
}

/** The Measure passes among `spans` that started in `[from, to]` (`>=`: Firefox's whole-millisecond timer). */
const dragPassesOf = (spans: ReadonlyArray<SpanRecord>, from: number, to: number): DragPasses => {
  const perPass: Array<DragPass> = []
  let seeding = 0
  let dragBlocked = 0
  for (const span of spans) {
    if (span.name !== MEASURE_SPAN || span.start < from || span.start > to) continue
    const pass: DragPass = {
      start: span.start,
      seeded: countOf(span.attributes.seeded),
      dragBlocked: countOf(span.attributes.dragBlocked),
    }
    perPass.push(pass)
    if (pass.seeded > 0) seeding++
    dragBlocked += pass.dragBlocked
  }
  return { count: perPass.length, seeding, dragBlocked, perPass }
}

/** {@link DragRun.releaseHeld} (see there). */
const releaseHeldOf = (frames: ReadonlyArray<DragFrame>, releaseAt: number | null): number | null => {
  if (releaseAt === null) return null
  let heldBox: Box | undefined
  let last: DragFrame | undefined
  let held = 0
  for (const f of frames) {
    if (f.frameAt < releaseAt) {
      heldBox = f.d
      continue
    }
    if (heldBox === undefined) return null
    if (boxDistance(f.d, heldBox) > MOVED_PX) return held
    held++
    last = f
  }
  if (heldBox === undefined || last === undefined) return null
  // Nothing moved after the release: fine when there was nowhere to go, stuck otherwise.
  return boxDistance(heldBox, last.slot) <= NEAR_PX ? 0 : null
}

/**
 * Reads a {@link DragRun} from one press's `input` and the spans the lab joined for
 * it (the recorded spans that started in `[input.grabAt, input.endedAt]`; any
 * others are ignored for `passes` but kept in `spans`). Each field's doc on
 * {@link DragRun} says how it is computed. `input.moves` and `input.frames` are
 * oldest first. Runs once per drag, never per frame.
 */
export const dragRunOf = (input: DragRunInput, spans: ReadonlyArray<SpanRecord>): DragRun => {
  const { frames, releaseAt } = input
  const moves = dragMovesOf(input.moves)
  const grabCentre = centreOf(input.grabBox)
  const targetOf = (m: DragMove): Point => ({ x: grabCentre.x + m.dx, y: grabCentre.y + m.dy })
  const firstMove = moves[0]
  const held =
    firstMove === undefined
      ? []
      : frames.filter((f) => f.frame > firstMove.frame && (releaseAt === null || f.frameAt < releaseAt))

  // One walk over the held frames: the distance from the latest move each could
  // show, and the newest move each one's painted centre does show (-1 for none).
  // With Effect's default scheduler a move reaches the drag one hop (a frame) late,
  // so "could show" means handled before the frame before (see `scheduler`): the
  // under-pointer check then catches a position error, and `framesBehindMax` the lag.
  const hop = (input.scheduler ?? "default") === "default" ? 1 : 0
  let underPointerMaxPx = 0
  const newestShown: Array<number> = []
  let visible = 0
  let reachable = 0
  for (const f of held) {
    while (visible < moves.length && moves[visible].frame < f.frame) visible++
    while (reachable < moves.length && moves[reachable].frame < f.frame - hop) reachable++
    const centre = centreOf(f.d)
    if (reachable > 0) underPointerMaxPx = Math.max(underPointerMaxPx, pointDistance(centre, targetOf(moves[reachable - 1])))
    let shown = -1
    for (let j = visible - 1; j >= 0; j--) {
      if (pointDistance(centre, targetOf(moves[j])) <= NEAR_PX) {
        shown = j
        break
      }
    }
    newestShown.push(shown)
  }

  let framesBehindMax: number | null = null
  let framesBehindMoves = 0
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    // Replaced before any frame could show it.
    if (moves[i + 1]?.frame === move.frame) continue
    let behind = 0
    let measured = false
    for (let k = 0; k < held.length; k++) {
      if (held[k].frame <= move.frame) continue
      measured = true
      if (newestShown[k] >= i) break
      behind++
    }
    if (!measured) continue
    framesBehindMoves++
    framesBehindMax = Math.max(framesBehindMax ?? 0, behind)
  }

  const childGlueMaxPx: Record<string, number> = {}
  for (const [name, offset] of Object.entries(input.childOffsets)) {
    let max: number | undefined
    for (const f of frames) {
      const child: Box | undefined = f.children[name]
      if (child === undefined) continue
      const drift = pointDistance({ x: child.x - f.d.x, y: child.y - f.d.y }, offset)
      max = max === undefined ? drift : Math.max(max, drift)
    }
    if (max !== undefined) childGlueMaxPx[name] = max
  }

  const last = frames[frames.length - 1]
  const endsOnSlotPx =
    releaseAt === null || last === undefined || last.frameAt < releaseAt ? null : boxDistance(last.d, last.slot)

  return {
    ...input,
    heldFrameCount: held.length,
    underPointerMaxPx,
    framesBehindMax,
    framesBehindMoves,
    childGlueMaxPx,
    passes: dragPassesOf(spans, input.grabAt, input.endedAt),
    releaseHeld: releaseHeldOf(frames, releaseAt),
    endsOnSlotPx,
    spans,
  }
}

/**
 * The card's `passes` text for a drag run: `N (M seeding, K drag-blocked)`, where M
 * is the passes that seeded a node and K the sum of `dragBlocked` over every pass
 * (#26: `1 (1 seeding, 2 drag-blocked)` for a sibling's resize while the item is
 * held, the sibling seeded and the item and its `layout` child drag-blocked). `0`
 * for a run no Measure pass ran in.
 */
export const formatDragPasses = (passes: DragPasses): string =>
  passes.count === 0 ? "0" : `${passes.count} (${passes.seeding} seeding, ${passes.dragBlocked} drag-blocked)`

/** A distance as the card prints it, e.g. `0.25 px`. */
const px = (n: number): string => `${n.toFixed(2)} px`

/** One card line: the value alone with no expectation, `value ✓` when it holds, `value ✗ expected …` when not. */
const lineOf = (name: DragCheckName, value: string, expected: string | undefined, ok: boolean): DragCheck => {
  if (expected === undefined) return { name, ok: true, text: value }
  return { name, ok, text: ok ? `${value} ✓` : `${value} ✗ expected ${expected}` }
}

/**
 * Checks `run` against `expect`: one {@link DragCheck} per name in
 * {@link DRAG_CHECK_NAMES}, in that order. A value the run could not measure reads
 * `?` and fails its check (the expected drag did not happen), as a `null` hold does
 * on a trigger card. A held pass fails the `passes` check when it seeded more than
 * `expect.maxSeededPerPass` nodes, and the held passes fail it when none of them
 * drag-blocked anything (one pass may find nothing left to change: a resize both a
 * `layoutDependency` and the engine's ResizeObserver report runs two). A held pass started after the
 * drag's first move past the threshold (a pass at the pointerdown comes before the
 * drag) and before the release.
 */
export const dragChecksOf = (run: DragRun, expect: DragExpect): Array<DragCheck> => {
  const under = run.heldFrameCount === 0 ? undefined : run.underPointerMaxPx
  const glue = Object.entries(run.childGlueMaxPx)
  const releaseAt = run.releaseAt
  // A held pass ran while the item was dragged: from the drag's start (its first move
  // past the threshold; a pass at the pointerdown, before it, drag-blocks nothing) to
  // the release.
  const started = run.moves.find((m) => Math.hypot(m.dx, m.dy) > DRAG_THRESHOLD_PX)?.t ?? run.grabAt
  const heldPasses = run.passes.perPass.filter(
    (p) => p.start >= started && (releaseAt === null || p.start < releaseAt),
  )
  const {
    underPointerMaxPx: underMax,
    childGlueMaxPx: glueMax,
    maxSeededPerPass: seededMax,
    endsOnSlotMaxPx: slotMax,
  } = expect
  const behindMax = forScheduler(expect.framesBehindMax, run)
  const releaseHeldMax = forScheduler(expect.releaseHeldMax, run)
  return [
    lineOf(
      "under pointer",
      `${under === undefined ? "?" : px(under)}${run.pointerLeft === true ? " · the pointer left the item" : ""}`,
      underMax === undefined ? undefined : `≤ ${underMax} px`,
      under !== undefined && underMax !== undefined && under <= underMax,
    ),
    lineOf(
      "frames behind",
      run.framesBehindMax === null
        ? "?"
        : `${run.framesBehindMax} · ${run.framesBehindMoves} move${run.framesBehindMoves === 1 ? "" : "s"}`,
      behindMax === undefined ? undefined : `≤ ${behindMax}`,
      run.framesBehindMax !== null && behindMax !== undefined && run.framesBehindMax <= behindMax,
    ),
    lineOf(
      "child glued",
      glue.length === 0 ? "?" : `${glue.map(([name, drift]) => `${name} ${drift.toFixed(2)}`).join(" · ")} px`,
      glueMax === undefined ? undefined : `≤ ${glueMax} px`,
      glue.length > 0 && glueMax !== undefined && glue.every(([, drift]) => drift <= glueMax),
    ),
    lineOf(
      "passes",
      formatDragPasses(run.passes),
      seededMax === undefined ? undefined : `seeded ≤ ${seededMax} per held pass, drag-blocked ≥ 1 over them`,
      seededMax !== undefined &&
        heldPasses.every((p) => p.seeded <= seededMax) &&
        (heldPasses.length === 0 || heldPasses.some((p) => p.dragBlocked >= 1)),
    ),
    lineOf(
      "release held",
      run.releaseHeld === null ? "?" : String(run.releaseHeld),
      releaseHeldMax === undefined ? undefined : `≤ ${releaseHeldMax}`,
      run.releaseHeld !== null && releaseHeldMax !== undefined && run.releaseHeld <= releaseHeldMax,
    ),
    lineOf(
      "ends on slot",
      run.endsOnSlotPx === null ? "?" : px(run.endsOnSlotPx),
      slotMax === undefined ? undefined : `≤ ${slotMax} px`,
      run.endsOnSlotPx !== null && slotMax !== undefined && run.endsOnSlotPx <= slotMax,
    ),
  ]
}
