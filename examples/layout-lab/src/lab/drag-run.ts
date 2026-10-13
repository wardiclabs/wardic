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
 * Not every press is a whole drag (#31's lab fix, from Devin's desktop log of
 * 2026-09-29). A press that never moves past the drag threshold is a click, and the
 * card reads it as one. A run the next press cut short while its release was still
 * settling (`endedBy`) has no settled last frame, so the card doesn't judge where it
 * ended.
 *
 * #31's own line, `gesture ends`, reads whether the press's gesture ended where
 * ADR-0019 says a gesture ends: at its release, or, when the release was lost, at the
 * pointer's first unpressed move (a Stale gesture's rule A) or its next press (rule
 * B). It fails when a gesture went on moving the item after that point: following the
 * unpressed pointer, never flying the item to its slot, dragging it between two presses
 * (the next run inherits it), or dragging it under a press of a pointer that isn't the
 * Primary pointer. The lab's "lose the next release" toggle makes a lost release on
 * purpose (`releaseLost`), as the regression tests do.
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
import type { ReorderFrame, ReorderRunData } from "./reorder-run.ts"

/** The span that marks one Measure pass. */
const MEASURE_SPAN = "wardic.projection.measure"

/**
 * How far the pointer must move from where it went down before the drag starts, in
 * px: `THRESHOLD` in `packages/core/src/recognizers/drag.ts` (more than 3px,
 * straight-line). A move within it moves nothing, so it is not one of the drag's
 * moves.
 */
const DRAG_THRESHOLD_PX = 3

/** `b` moved by `by`. */
const offsetBy = (b: Box, by: Point): Box => ({ ...b, x: b.x + by.x, y: b.y + by.y })

/**
 * How far a settled run's item rests off its slot (its last frame), when that is sub-pixel
 * ({@link SUBPIXEL_PX}); zero when the run didn't settle or ended further off (`ends on slot`
 * judges that).
 */
const restOffsetOf = (input: DragRunInput): Point => {
  const last = input.frames[input.frames.length - 1]
  if (input.endedBy !== "settled" || last === undefined) return { x: 0, y: 0 }
  const off = { x: last.d.x - last.slot.x, y: last.d.y - last.slot.y }
  return Math.abs(off.x) < SUBPIXEL_PX && Math.abs(off.y) < SUBPIXEL_PX ? off : { x: 0, y: 0 }
}

/** The "same place" distance, in px: a painted centre within it of a target shows that target. */
const NEAR_PX = 1

/**
 * How near the pointer's hold a grab mid-flight's item must come to have landed there, in px
 * (#30): well inside the under-pointer bound, so the flight's last sub-pixel steps don't read
 * as the drag's error.
 */
const LANDED_PX = 0.25

/**
 * The most a settled item's painted box may sit off its slot and still read as where it rests, in
 * px: the slot is read from whole-pixel offsets, so an item can rest up to half a pixel off it (a
 * hand run at DPR 1.35 read 0.22–0.26 px, more than {@link LANDED_PX}).
 */
const SUBPIXEL_PX = 0.5

/**
 * The most a grab mid-flight's first dragged frame may move beyond the pointer, as a share of
 * the flight still to go then (or {@link JUMP_FLOOR_PX}, whichever is more): a frame's step of
 * a flight that goes on, not the whole of it (main's #30 jump).
 */
const JUMP_SHARE = 0.5
const JUMP_FLOOR_PX = 2

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

/** One pointer move the recorder handled: while the item was pressed (`moves`), or after the release (`releaseMoves`). */
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
  /**
   * The pointer's pressed buttons (`PointerEvent.buttons`): 1 or more while pressed, 0
   * once released. Left out in a log from before #31's lab fix.
   */
  readonly buttons?: number
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
  /**
   * Painted boxes no check judges, by name, for a scenario that records one (scenario
   * 12's M, which moves by design: #38). Left out otherwise.
   */
  readonly watched?: Readonly<Record<string, Box>>
  /** Painted opacities, by name, for a scenario that watches them (a dragged `layoutId` lead). */
  readonly opacity?: Readonly<Record<string, number>>
  /** A `<Reorder>` scenario's reads of the frame (scenario 14, `lab/reorder-run.ts`); left out otherwise. */
  readonly reorder?: ReorderFrame
  /**
   * Whether the scenario's scroller moved since the previous read (scenario 14). Such a
   * frame isn't judged under pointer or frames behind: Auto-scroll's step lands in the
   * frame before the drag's compensation for it, so the item trails by the step there,
   * as Motion's does (motion/react 13.4.6 trails by up to 24px, #44). Left out otherwise.
   */
  readonly scrolled?: boolean
}

/** Why a drag scenario's recorder stopped after the release (see {@link DragRunInput.endedBy}). */
export type DragRunEnd = "settled" | "timeout" | "next-press" | "removed"

/** Whether a run stopped before its release could settle: the next press, or its item leaving the page. */
const cutShort = (end: DragRunEnd | undefined): boolean => end === "next-press" || end === "removed"

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
  /**
   * The pointer's moves after the release until the recorder stopped, oldest first,
   * with their `buttons`: what the item did once its gesture should have ended. Left
   * out in a log from before #31's lab fix.
   */
  readonly releaseMoves?: ReadonlyArray<DragMove>
  /**
   * The pointer that pressed: its `pointerType`, the `button` that went down, and
   * `isPrimary`. Only the Primary pointer drags (ADR-0019: a mouse's left button, or
   * the first touch or pen contact), so a press of another moves nothing. Left out in a
   * log from before #31's lab fix, whose presses read as primary.
   */
  readonly pointer?: { readonly type: string; readonly button: number; readonly isPrimary: boolean }
  /** One sample per frame painted after the grab, oldest first, through the settle after the release. */
  readonly frames: ReadonlyArray<DragFrame>
  /** Each watched child's painted offset from the dragged element at the grab, by name. */
  readonly childOffsets: Readonly<Record<string, Point>>
  /** When the pointer went up (ms), or `null` when the press never ended in a release. */
  readonly releaseAt: number | null
  /**
   * Whether the release never reached the page's listeners: the scenario's "lose the
   * next release" toggle swallowed the pointerup (#31, as another page script could),
   * or the browser never sent one (a release outside the window, where headless
   * Firefox sent only moves with no button pressed in #31's checks; the first is taken
   * as the release). `releaseAt` is still when it happened. Left out when the release
   * arrived.
   */
  readonly releaseLost?: boolean
  /** When the recorder stopped (ms). {@link endedBy} says why. */
  readonly endedAt: number
  /**
   * Why the recorder stopped after the release: `settled` (the item's painted box stood
   * still for the recorder's `STILL_FRAMES` frames), `timeout` (its `SETTLE_MS` passed
   * first), `next-press` (the next press started while the release was still
   * settling: the run was cut short, so its last frame may still be on the way to the
   * slot) or `removed` (the item left the page while the run was on, as scenario 13's boxes
   * remount it: cut short the same way). Left out in a log from before #31's lab fix, whose
   * runs are judged as if they had settled.
   */
  readonly endedBy?: DragRunEnd
  /**
   * Whether a pointer event of the press landed outside the dragged element (a move
   * too fast for it, or the release). Before #31's fix Wardic's drag listened on the
   * element itself, so from there it stopped following and a release outside didn't
   * end it; since ADR-0019 the drag keeps its pointer, and this is information only.
   * Left out when it never happened.
   */
  readonly pointerLeft?: boolean
  /**
   * Effect's scheduler on the page (`currentLabScheduler()`): `default` is a browser's
   * own (`setTimeout(0)`, as no browser has `setImmediate`), `microtask` the browser
   * test harness's `queueMicrotask`-backed one (`?scheduler=microtask`). Since #32 pointer
   * input reaches Wardic's drag inside its event with either (ADR-0032); before, one
   * scheduler hop made it a frame later with `default`. Left out, `default`.
   */
  readonly scheduler?: "default" | "microtask"
  /** A `<Reorder>` scenario's press (scenario 14, `lab/reorder-run.ts`); left out otherwise. */
  readonly reorder?: ReorderRunData
  /**
   * The gesture's axis lock, when it has one (scenario 14's rows and lists: the group
   * decides it per gesture). Under pointer and frames behind then compare that axis
   * alone: the item rightly doesn't follow the pointer across it (a page scroll across
   * an `x` row). Left out, both axes.
   */
  readonly lock?: "x" | "y"
  /**
   * The item's own layout animation was running at the press (the scenario says so,
   * scenario 13 after Z or P at rest): its slot then. A grab leaves that flight running
   * under the pointer, as Motion's does (#30, ADR-0016 *Amendment (velocity family)*),
   * so the item slides the rest of the way to where the pointer holds it: its slot moved
   * by the pointer. Left out otherwise.
   */
  readonly grabFlight?: { readonly slot: Box }
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
 * What the `gesture ends` line reads (#31, ADR-0019): where the press's gesture should
 * have ended, and each sign that a gesture moved the item when none should have (a
 * Stale gesture, or the press of a pointer that isn't the Primary pointer). Every field
 * is JSON-safe.
 */
export interface GestureEnd {
  /**
   * Where the gesture should end: its `release`, or, with a lost release, its first
   * `unpressed move` (rule A). `null` with no release, or a lost release no unpressed
   * move followed before the recorder stopped: the next press ends it (rule B), and
   * that press's run judges it ({@link pressOnOpen}).
   */
  readonly at: "release" | "unpressed move" | null
  /** How many frames were painted after that point (0 with no such point). */
  readonly framesAfter: number
  /**
   * How far the item followed the unpressed pointer after that point, in px: the
   * largest distance of its painted centre from where it was at that point, over the
   * frames that sat where the pointer put it (within 1px, off the slot, two frames in a
   * row, once the pointer had moved more than 1px from its last pressed point). 0 when
   * it never did.
   */
  readonly followedPx: number
  /**
   * How far off its slot the item stayed, in px, when no frame after that point moved:
   * the gesture never ended (a release with nowhere to go, already on its slot, isn't
   * stuck). `null` otherwise, and for a run the next press cut short (too soon to say).
   */
  readonly stuckPx: number | null
  /**
   * How far the item moved between the end of this scenario's previous run (its last
   * frame) and this grab, in px, when that run left its gesture on
   * ({@link openAtEnd}): a Stale gesture following the unpressed pointer between the
   * two presses. 0 when the item was back on its slot at the grab (the gesture ended in
   * between, at an unpressed move, and flew it there). `null` with no previous run, one
   * whose gesture ended, or one this press cut short (no time in between).
   */
  readonly inheritedPx: number | null
  /**
   * For a press on a gesture the previous run left on ({@link openAtEnd}): whether this
   * press ended it (rule B), read from the frames after its down and before its drag
   * started or it was released. `ended` when the item moved without following the
   * pointer (a release flying it to its slot), or was already on its slot; `not ended`
   * when it stood still or moved exactly as the pointer did (the old gesture); `unseen`
   * with no such frame. `null` for any other press.
   */
  readonly pressOnOpen: "ended" | "not ended" | "unseen" | null
  /**
   * How far a press of a pointer that isn't the Primary pointer moved the item before
   * its release, in px (the largest `boxDistance` from the grab box). 0 for a primary
   * press.
   */
  readonly notPrimaryPx: number
  /**
   * Whether the gesture was still on when the recorder stopped: a lost release no
   * unpressed move ended, a stuck item, or one still following the unpressed pointer.
   * The scenario's next press then starts on it ({@link inheritedPx}, {@link pressOnOpen}).
   */
  readonly openAtEnd: boolean
  /**
   * The largest of {@link followedPx}, {@link inheritedPx} and {@link notPrimaryPx}: how
   * far a gesture moved the item when none should have been moving it.
   */
  readonly stalePx: number
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
   * painted centre and the grab box's centre moved by the nearest of the moves it
   * could show: from the latest handled before that frame's rAF callback (with the
   * `default` scheduler, before the previous frame's: the input's hop, see
   * {@link DragRunInput.scheduler}) to the newest (a move a Measure pass flushed at
   * once, or a scroll's, shows with no hop: #44). Centres, so a slot resize mid-drag,
   * which paints the new size about the same centre (ADR-0016 *Amendment (#26)*),
   * reads 0. 0 with no held frame.
   */
  readonly underPointerMaxPx: number
  /**
   * A grab mid-flight ({@link DragRunInput.grabFlight}): how far the flight still had to
   * go at the press (`slidePx`, centre to centre), how far the first dragged frame moved
   * beyond the pointer from the frame before the drag started, its flight step included
   * (`jumpPx`; main's #30 jumped the whole remaining flight), and whether the flight
   * landed under the pointer before the release. {@link underPointerMaxPx} is then read
   * against the slot at the press moved by the pointer, from the frame it landed in.
   */
  readonly flight?: {
    readonly slidePx: number
    readonly jumpPx: number | null
    readonly remainingPx: number | null
    readonly landed: boolean
  }
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
   * frame's rAF callbacks. With a lost release it counts from where the gesture
   * should end instead ({@link GestureEnd.at}: its first unpressed move, by frame
   * counter), and is `null` when no such move came.
   */
  readonly releaseHeld: number | null
  /**
   * The distance between the last frame's painted box and its slot, in px (the
   * largest difference over x, y, width and height). `null` with no release or no
   * frame after it (after a lost release's first unpressed move).
   */
  readonly endsOnSlotPx: number | null
  /** What the `gesture ends` line reads (#31). */
  readonly gestureEnd: GestureEnd
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
  /** The most {@link DragRun.framesBehindMax} may read (per scheduler, before #32: the input's hop added one with `default`). */
  readonly framesBehindMax?: PerScheduler
  /** The most any child's {@link DragRun.childGlueMaxPx} may read, in px. */
  readonly childGlueMaxPx?: number
  /**
   * The most nodes a held pass may seed. Given, the held passes must also have
   * drag-blocked at least one node between them: a pass during the drag moves the
   * dragged tree's slots without animating them (scenario 11: 1, the sibling only).
   */
  readonly maxSeededPerPass?: number
  /** The most {@link DragRun.releaseHeld} may read (per scheduler, before #32: the release's hop could add one with `default`). */
  readonly releaseHeldMax?: PerScheduler
  /** The most {@link DragRun.endsOnSlotPx} may read, in px. */
  readonly endsOnSlotMaxPx?: number
  /**
   * The most {@link GestureEnd.stalePx} may read, in px (#31): how far a gesture may
   * move the item when none should be moving it. Given, a gesture that never ends
   * (stuck, or not ended by the press on it) fails the line too.
   */
  readonly gestureEndsMaxPx?: number
}

/** The card's drag lines, in display order. {@link dragChecksOf} returns one check per name. */
export const DRAG_CHECK_NAMES = [
  "under pointer",
  "frames behind",
  "child glued",
  "passes",
  "release held",
  "ends on slot",
  "gesture ends",
] as const

/** One of {@link DRAG_CHECK_NAMES}. */
export type DragCheckName = (typeof DRAG_CHECK_NAMES)[number]

/** The six lines of a drag (#26's), which a press that isn't a drag doesn't judge. */
const DRAG_LINE_NAMES = DRAG_CHECK_NAMES.filter((name) => name !== "gesture ends")

/** Every drag line of a press that never moved past {@link DRAG_THRESHOLD_PX}: no drag started. */
const CLICK_TEXT = "click, no drag"

/** Every drag line of a press of a pointer that isn't the Primary pointer, which must not drag. */
const NOT_PRIMARY_TEXT = "not the primary pointer, no drag"

/** The `release held` and `ends on slot` note of a run the next press cut short (`endedBy: "next-press"`). */
const CUT_SHORT_TEXT = "cut short by the next press"

/** The same note for a run whose item left the page (`endedBy: "removed"`). */
const REMOVED_TEXT = "cut short: the item left the page"

/** The note of a run cut short, by why it was. */
const cutTextOf = (run: DragRun): string => (run.endedBy === "removed" ? REMOVED_TEXT : CUT_SHORT_TEXT)

/** The `release held` and `ends on slot` text of a lost release no unpressed move followed: its gesture hadn't ended. */
const LOST_OPEN_TEXT = "lost release, no unpressed move"

/**
 * How closely a Stale gesture moves the item with the pointer, in px: exactly, since it
 * applies the pointer's offset. A release flying the item to its slot matches the
 * pointer's offset to within this only by chance.
 */
const EXACT_PX = 0.25

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

/** Whether the press was the Primary pointer's (Motion's `isPrimaryPointer`); a log from before #31's lab fix reads as primary. */
const isPrimaryPress = (input: DragRunInput): boolean =>
  input.pointer === undefined || (input.pointer.type === "mouse" ? input.pointer.button <= 0 : input.pointer.isPrimary)

/** Where a press's gesture should end ({@link GestureEnd.at}) and when. */
interface EndPoint {
  readonly at: "release" | "unpressed move"
  readonly t: number
  /** The unpressed move's frame counter. A release has none: its frames go by time (see {@link DragRun.releaseHeld}). */
  readonly frame: number | undefined
  /** The index in `releaseMoves` of the first move from the end point on (0 for a release). */
  readonly from: number
}

/** Whether frame `f` was painted after `end`: by frame counter after a move, by time (`>=`) after a release. */
const isAfter = (f: DragFrame, end: EndPoint): boolean => (end.frame === undefined ? f.frameAt >= end.t : f.frame > end.frame)

/** The press's end point (see {@link GestureEnd.at}), or `null` when it has none. */
const endPointOf = (input: DragRunInput): EndPoint | null => {
  if (input.releaseAt === null) return null
  if (input.releaseLost !== true) return { at: "release", t: input.releaseAt, frame: undefined, from: 0 }
  const moves = input.releaseMoves ?? []
  const i = moves.findIndex((m) => m.buttons === 0)
  return i === -1 ? null : { at: "unpressed move", t: moves[i].t, frame: moves[i].frame, from: i }
}

/** {@link DragRun.releaseHeld} (see there), counted from the press's end point. */
const releaseHeldOf = (frames: ReadonlyArray<DragFrame>, end: EndPoint | null): number | null => {
  if (end === null) return null
  let heldBox: Box | undefined
  let last: DragFrame | undefined
  let held = 0
  for (const f of frames) {
    if (!isAfter(f, end)) {
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
 * {@link DragRun.gestureEnd} (see {@link GestureEnd} for each field). `previous` is the
 * scenario's run before this one, `hop` the input's scheduler hop in frames (see
 * `dragRunOf`).
 */
const gestureEndOf = (
  input: DragRunInput,
  end: EndPoint | null,
  previous: DragRun | undefined,
  hop: number,
): GestureEnd => {
  const { frames, grabBox, releaseAt } = input
  const grabCentre = centreOf(grabBox)
  const targetOf = (m: DragMove): Point => ({ x: grabCentre.x + m.dx, y: grabCentre.y + m.dy })
  const lastMove = input.moves[input.moves.length - 1]
  // The pointer's last pressed point: where a Stale gesture's rule A ends the drag.
  const pressedAt = lastMove === undefined ? grabCentre : targetOf(lastMove)

  // After the end point: whether any frame moved, and the frames that sat where the
  // unpressed pointer put the item (the latest move each frame could show, or the one
  // before it with the scheduler's hop).
  let framesAfter = 0
  let followedPx = 0
  let moved = false
  let endBox = grabBox
  if (end !== null) {
    const unpressed = (input.releaseMoves ?? []).slice(end.from).filter((m) => m.buttons === 0)
    // At the move's place exactly, as a gesture left on applies the pointer's offset: a release
    // carrying on in the drag's direction, or flying back past where the pointer rests, comes
    // within a pixel of it for a frame or two by chance (ADR-0016's momentum).
    const sitsAt = (centre: Point, m: DragMove | undefined): boolean =>
      m !== undefined && pointDistance(targetOf(m), pressedAt) > NEAR_PX && pointDistance(centre, targetOf(m)) <= EXACT_PX
    let visible = 0
    let reachable = 0
    let inARow = 0
    for (const f of frames) {
      if (!isAfter(f, end)) {
        endBox = f.d
        continue
      }
      framesAfter++
      if (boxDistance(f.d, endBox) > MOVED_PX) moved = true
      while (visible < unpressed.length && unpressed[visible].frame < f.frame) visible++
      while (reachable < unpressed.length && unpressed[reachable].frame < f.frame - hop) reachable++
      const centre = centreOf(f.d)
      const sits =
        boxDistance(f.d, f.slot) > NEAR_PX && (sitsAt(centre, unpressed[visible - 1]) || sitsAt(centre, unpressed[reachable - 1]))
      inARow = sits ? inARow + 1 : 0
      // Three frames in a row: a gesture left on follows every move, while a release that
      // carries on the pointer's way and turns back can pass its place twice by chance.
      if (inARow >= 3) followedPx = Math.max(followedPx, pointDistance(centre, centreOf(endBox)))
    }
  }
  const lastSlot = frames[frames.length - 1]?.slot
  const offAtEnd = lastSlot === undefined ? 0 : boxDistance(endBox, lastSlot)
  const stuckPx = framesAfter > 0 && !moved && !cutShort(input.endedBy) && offAtEnd > NEAR_PX ? offAtEnd : null

  let notPrimaryPx = 0
  if (!isPrimaryPress(input)) {
    for (const f of frames) {
      if (releaseAt === null || f.frameAt < releaseAt) notPrimaryPx = Math.max(notPrimaryPx, boxDistance(f.d, grabBox))
    }
  }

  // A press on a gesture the scenario's previous run left on.
  const firstSlot = frames[0]?.slot
  const offSlotAtGrab = firstSlot === undefined || boxDistance(grabBox, firstSlot) > NEAR_PX
  let inheritedPx: number | null = null
  let pressOnOpen: GestureEnd["pressOnOpen"] = null
  if (previous !== undefined && previous.gestureEnd.openAtEnd) {
    const previousEnd = previous.frames[previous.frames.length - 1]?.d ?? previous.grabBox
    if (!cutShort(previous.endedBy)) inheritedPx = offSlotAtGrab ? boxDistance(grabBox, previousEnd) : 0
    if (!offSlotAtGrab) pressOnOpen = "ended"
    else {
      // Rule B: this down ends the old gesture, whose release then flies the item to its
      // slot. Read before this press's own drag starts, or its release.
      const start = dragMovesOf(input.moves)[0]
      const before = frames.filter(
        (f) => (start === undefined || f.frame <= start.frame) && (releaseAt === null || f.frameAt < releaseAt),
      )
      let flew = false
      let followed = false
      for (const f of before) {
        if (boxDistance(f.d, grabBox) <= MOVED_PX) continue
        flew = true
        // The old gesture moves the item by exactly the pointer's offset.
        const dx = f.d.x - grabBox.x
        const dy = f.d.y - grabBox.y
        if (input.moves.some((m) => m.frame < f.frame && Math.abs(m.dx - dx) <= EXACT_PX && Math.abs(m.dy - dy) <= EXACT_PX)) {
          followed = true
        }
      }
      pressOnOpen = before.length === 0 ? "unseen" : flew && !followed ? "ended" : "not ended"
    }
  }

  const lostOpen = input.releaseLost === true && releaseAt !== null && end === null
  return {
    at: end?.at ?? null,
    framesAfter,
    followedPx,
    stuckPx,
    inheritedPx,
    pressOnOpen,
    notPrimaryPx,
    openAtEnd: lostOpen || stuckPx !== null || followedPx > 0,
    stalePx: Math.max(followedPx, inheritedPx ?? 0, notPrimaryPx),
  }
}

/**
 * A grab mid-flight's numbers ({@link DragRun.flight}): the flight still to go at the
 * press; the first dragged frame's move beyond the pointer from the last frame before the
 * drag started, and the flight still to go in that frame; and whether it landed.
 */
const flightOf = (
  input: DragRunInput,
  grabSlot: Box,
  held: ReadonlyArray<DragFrame>,
  moves: ReadonlyArray<DragMove>,
  landed: boolean,
): { readonly slidePx: number; readonly jumpPx: number | null; readonly remainingPx: number | null; readonly landed: boolean } => {
  const slot = centreOf(grabSlot)
  const slidePx = pointDistance(centreOf(input.grabBox), slot)
  const first = held[0]
  // The last frame before the drag started, or the box at the press when none was painted.
  const before = first === undefined ? undefined : input.frames.filter((f) => f.frame < first.frame).at(-1)
  const shown = first === undefined ? undefined : moves.filter((m) => m.frame < first.frame).at(-1)
  if (first === undefined || shown === undefined) return { slidePx, jumpPx: null, remainingPx: null, landed }
  const from = centreOf(before?.d ?? input.grabBox)
  const at = centreOf(first.d)
  const jumpPx = pointDistance({ x: at.x - shown.dx, y: at.y - shown.dy }, from)
  return { slidePx, jumpPx, remainingPx: pointDistance(from, slot), landed }
}

/**
 * Reads a {@link DragRun} from one press's `input` and the spans the lab joined for
 * it (the recorded spans that started in `[input.grabAt, input.endedAt]`; any
 * others are ignored for `passes` but kept in `spans`). `previous` is the same
 * scenario's run before it, if any: whether this press started on a gesture that run
 * left on (#31, {@link GestureEnd.inheritedPx}). Each field's doc on {@link DragRun}
 * says how it is computed. `input.moves` and `input.frames` are oldest first. Runs
 * once per drag, never per frame.
 */
export const dragRunOf = (input: DragRunInput, spans: ReadonlyArray<SpanRecord>, previous?: DragRun): DragRun => {
  const { frames, releaseAt } = input
  const moves = dragMovesOf(input.moves)
  // A grab mid-flight lands where the pointer holds the slot it was flying to (#30), where the
  // item rests against that slot: a settled run's last frame says how far off, sub-pixel.
  const flightSlot = input.grabFlight === undefined ? undefined : offsetBy(input.grabFlight.slot, restOffsetOf(input))
  const grabCentre = centreOf(flightSlot ?? input.grabBox)
  const targetOf = (m: DragMove): Point => ({ x: grabCentre.x + m.dx, y: grabCentre.y + m.dy })
  const firstMove = moves[0]
  const held =
    firstMove === undefined
      ? []
      : frames.filter((f) => f.frame > firstMove.frame && (releaseAt === null || f.frameAt < releaseAt))

  // One walk over the held frames: the distance from the latest move each could
  // show, and the newest move each one's painted centre does show (-1 for none).
  // Before #32, with Effect's default scheduler a move reached the drag one hop (a frame)
  // late, so "could show" means handled before the frame before (see `scheduler`): the
  // under-pointer check then catches a position error, and `framesBehindMax` the lag. It
  // stays a tolerance of under pointer only: frames behind reads the lag itself, and the
  // drag cards hold it at 0 with either scheduler (ADR-0032).
  const hop = (input.scheduler ?? "default") === "default" ? 1 : 0
  // The distance the checks compare: the gesture's locked axis alone, when it has one.
  const lock = input.lock
  const distance = (a: Point, b: Point): number =>
    lock === "x" ? Math.abs(a.x - b.x) : lock === "y" ? Math.abs(a.y - b.y) : pointDistance(a, b)
  // A frame in a scroll's wake (see `DragFrame.scrolled`): the scrolled frame, and with
  // the default scheduler the next one too, which the compensation's hop reaches late.
  const wake = held.map((f, k) => f.scrolled === true || (hop === 1 && k > 0 && held[k - 1]!.scrolled === true))
  let underPointerMaxPx = 0
  const newestShown: Array<number> = []
  let visible = 0
  let reachable = 0
  // A grab mid-flight is judged from the frame its flight lands under the pointer: under
  // pointer here, and frames behind for the moves from that frame on.
  let landed = input.grabFlight === undefined
  let landedFrame = Number.NEGATIVE_INFINITY
  for (const [k, f] of held.entries()) {
    while (visible < moves.length && moves[visible].frame < f.frame) visible++
    while (reachable < moves.length && moves[reachable].frame < f.frame - hop) reachable++
    const centre = centreOf(f.d)
    // Any move from the one the hop leaves it to the newest handled may be showing: a
    // reorder's Measure pass flushes the item at once, and a scroll reaches the drag in
    // the frame's own scroll steps (#44), so a frame can show the newest move.
    if (reachable > 0 && !wake[k]!) {
      let nearest = Number.POSITIVE_INFINITY
      for (let j = reachable - 1; j < visible; j++) nearest = Math.min(nearest, distance(centre, targetOf(moves[j])))
      // Landed: at the newest move's place, not just near an older one a slide in the
      // pointer's direction passes on its way.
      if (!landed && distance(centre, targetOf(moves[visible - 1])) <= LANDED_PX) {
        landed = true
        landedFrame = f.frame
      }
      if (landed) underPointerMaxPx = Math.max(underPointerMaxPx, nearest)
    }
    let shown = -1
    for (let j = visible - 1; j >= 0; j--) {
      if (distance(centre, targetOf(moves[j])) <= NEAR_PX) {
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
    // Made while a grab's flight was still sliding the item under the pointer (#30).
    if (!landed || move.frame + 1 < landedFrame) continue
    let behind = 0
    let measured = false
    for (let k = 0; k < held.length; k++) {
      if (held[k].frame <= move.frame) continue
      // A frame in a scroll's wake shows the scroll before its compensation (see `scrolled`).
      if (wake[k]!) continue
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

  // Where the gesture should end: the release, or a lost release's first unpressed move.
  const end = endPointOf(input)
  const last = frames[frames.length - 1]
  const endsOnSlotPx = end === null || last === undefined || !isAfter(last, end) ? null : boxDistance(last.d, last.slot)

  return {
    ...input,
    heldFrameCount: held.length,
    underPointerMaxPx,
    ...(flightSlot === undefined ? {} : { flight: flightOf(input, flightSlot, held, moves, landed) }),
    framesBehindMax,
    framesBehindMoves,
    childGlueMaxPx,
    passes: dragPassesOf(spans, input.grabAt, input.endedAt),
    releaseHeld: releaseHeldOf(frames, end),
    endsOnSlotPx,
    gestureEnd: gestureEndOf(input, end, previous, hop),
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
 * The `gesture ends` line (#31): the gesture's {@link GestureEnd.stalePx}, what the press
 * was (`click`, `not the primary pointer`, `lost release`), and each thing that
 * shows a gesture going on when it should have ended (`follows the unpressed pointer`,
 * `inherited a stale gesture`, `dragged it`, `never ends, … off its slot`, `the press
 * doesn't end the stale gesture`). Any of those fails it, a distance only past `bound`
 * (1px when left out). A click, a lost release no unpressed move followed, and a run
 * the next press cut short before any frame after its end point have nothing to judge
 * unless one of those shows.
 */
const gestureLineOf = (run: DragRun, click: boolean, bound: number | undefined): DragCheck => {
  const g = run.gestureEnd
  const limit = bound ?? NEAR_PX
  const primary = isPrimaryPress(run)
  const notes: Array<string> = []
  if (!primary) notes.push("not the primary pointer")
  else if (click) notes.push("click")
  if (run.releaseLost === true) notes.push("lost release")
  const misses: Array<string> = []
  if (g.followedPx > limit) misses.push("follows the unpressed pointer")
  if (g.inheritedPx !== null && g.inheritedPx > limit) misses.push("inherited a stale gesture")
  if (g.notPrimaryPx > limit) misses.push("dragged it")
  if (g.stuckPx !== null) misses.push(`never ends, ${px(g.stuckPx)} off its slot`)
  if (g.pressOnOpen === "not ended") misses.push("the press doesn't end the stale gesture")
  if (g.pressOnOpen === "unseen") misses.push("? whether the press ends the stale gesture")
  const expected = bound === undefined ? undefined : `≤ ${bound} px, and an end`
  if (misses.length === 0) {
    if (run.releaseAt === null) return lineOf("gesture ends", "?", expected, false)
    if (primary && click) {
      const rest = notes.filter((n) => n !== "click").map((n) => ` · ${n}`)
      return lineOf("gesture ends", `${CLICK_TEXT}${rest.join("")}`, undefined, true)
    }
    if (g.at === null) {
      const text = `${LOST_OPEN_TEXT}${cutShort(run.endedBy) ? " before the next press" : ""}`
      return lineOf("gesture ends", text, undefined, true)
    }
    if (g.framesAfter === 0 && cutShort(run.endedBy)) return lineOf("gesture ends", cutTextOf(run), undefined, true)
  }
  return lineOf("gesture ends", [px(g.stalePx), ...notes, ...misses].join(" · "), expected, misses.length === 0)
}

/**
 * Checks `run` against `expect`: one {@link DragCheck} per name in
 * {@link DRAG_CHECK_NAMES}, in that order. A press with no move past the drag
 * threshold is a click, not a drag: every drag line reads `click, no drag` and none
 * is judged. So does a press of a pointer that isn't the Primary pointer, which reads
 * `not the primary pointer, no drag` (ADR-0019: it must not drag). In a drag, a value
 * the run could not measure reads `?` and fails its check (the expected drag did not
 * happen), as a `null` hold does on a trigger card. A
 * held pass fails the `passes` check when it seeded more than
 * `expect.maxSeededPerPass` nodes, and the held passes fail it when none of them
 * drag-blocked anything (one pass may find nothing left to change: a resize both a
 * `layoutDependency` and the engine's ResizeObserver report runs two). A held pass started after the
 * drag's first move past the threshold (a pass at the pointerdown comes before the
 * drag) and before the release. A run the next press cut short
 * (`endedBy: "next-press"`) stopped while its release was still settling, so its
 * `ends on slot` shows the last frame's distance `· cut short by the next press` and
 * is not judged, nor is a `release held` it couldn't read (`? · cut short by the next
 * press`); a run that timed out is judged. A lost release no unpressed move followed
 * never reached its end in the run, so both read `lost release, no unpressed move`,
 * not judged. The `gesture ends` line is judged for every press (see `gestureLineOf`).
 */
/**
 * The `under pointer` line of a grab mid-flight (#30): judged from the frame the flight
 * landed under the pointer, and failed by a first dragged frame that jumps more than
 * {@link JUMP_SHARE} of the flight still to go (or {@link JUMP_FLOOR_PX}).
 */
const flightLineOf = (flight: NonNullable<DragRun["flight"]>, under: number | undefined, underMax: number | undefined): DragCheck => {
  const jumped =
    flight.jumpPx !== null && flight.remainingPx !== null && flight.jumpPx > Math.max(JUMP_FLOOR_PX, flight.remainingPx * JUMP_SHARE)
  const notes = [
    `after a ${px(flight.slidePx)} slide`,
    ...(jumped ? [`jumped ${px(flight.jumpPx!)} at the grab`] : []),
    ...(flight.landed ? [] : ["never landed"]),
  ]
  return lineOf(
    "under pointer",
    `${under === undefined || !flight.landed ? "?" : px(under)} · ${notes.join(" · ")}`,
    underMax === undefined ? undefined : `≤ ${underMax} px from its landing, no jump`,
    under !== undefined && underMax !== undefined && flight.landed && !jumped && under <= underMax,
  )
}

export const dragChecksOf = (run: DragRun, expect: DragExpect): Array<DragCheck> => {
  // The drag's start: its first move past the threshold. A press with none is a click.
  const startMove = run.moves.find((m) => Math.hypot(m.dx, m.dy) > DRAG_THRESHOLD_PX)
  const gesture = gestureLineOf(run, startMove === undefined, expect.gestureEndsMaxPx)
  if (!isPrimaryPress(run)) return [...DRAG_LINE_NAMES.map((name) => ({ name, ok: true, text: NOT_PRIMARY_TEXT })), gesture]
  if (startMove === undefined) return [...DRAG_LINE_NAMES.map((name) => ({ name, ok: true, text: CLICK_TEXT })), gesture]
  const under = run.heldFrameCount === 0 ? undefined : run.underPointerMaxPx
  const glue = Object.entries(run.childGlueMaxPx)
  const releaseAt = run.releaseAt
  // A held pass ran while the item was dragged: from the drag's start (a pass at the
  // pointerdown, before it, drag-blocks nothing) to the release.
  const started = startMove.t
  const heldPasses = run.passes.perPass.filter(
    (p) => p.start >= started && (releaseAt === null || p.start < releaseAt),
  )
  const { underPointerMaxPx: underMax, childGlueMaxPx: glueMax, endsOnSlotMaxPx: slotMax } = expect
  // The bound is per displaced item: a reorder run's items may each carry a layout child.
  const seededMax = expect.maxSeededPerPass === undefined ? undefined : expect.maxSeededPerPass * (run.reorder?.nodesPerItem ?? 1)
  const behindMax = forScheduler(expect.framesBehindMax, run)
  const releaseHeldMax = forScheduler(expect.releaseHeldMax, run)
  // A lost release no unpressed move followed: its gesture's end never came in the run.
  const lostOpen = run.releaseLost === true && run.gestureEnd.at === null
  const cut = cutShort(run.endedBy)
  return [
    run.flight === undefined
      ? lineOf(
          "under pointer",
          `${under === undefined ? "?" : px(under)}${run.pointerLeft === true ? " · the pointer left the item" : ""}`,
          underMax === undefined ? undefined : `≤ ${underMax} px`,
          under !== undefined && underMax !== undefined && under <= underMax,
        )
      : flightLineOf(run.flight, under, underMax),
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
    lostOpen
      ? lineOf("release held", LOST_OPEN_TEXT, undefined, true)
      : run.releaseHeld === null && cut
        ? // Cut before the release's first moving frame: too soon to read.
          lineOf("release held", `? · ${cutTextOf(run)}`, undefined, true)
        : lineOf(
            "release held",
            run.releaseHeld === null ? "?" : String(run.releaseHeld),
            releaseHeldMax === undefined ? undefined : `≤ ${releaseHeldMax}`,
            run.releaseHeld !== null && releaseHeldMax !== undefined && run.releaseHeld <= releaseHeldMax,
          ),
    lostOpen
      ? lineOf("ends on slot", LOST_OPEN_TEXT, undefined, true)
      : cut
        ? // Still settling when the next press came: the last frame is not where the release ends.
          lineOf(
            "ends on slot",
            run.endsOnSlotPx === null ? cutTextOf(run) : `${px(run.endsOnSlotPx)} · ${cutTextOf(run)}`,
            undefined,
            true,
          )
        : lineOf(
            "ends on slot",
            run.endsOnSlotPx === null ? "?" : px(run.endsOnSlotPx),
            slotMax === undefined ? undefined : `≤ ${slotMax} px`,
            run.endsOnSlotPx !== null && slotMax !== undefined && run.endsOnSlotPx <= slotMax,
          ),
    gesture,
  ]
}
