/**
 * The drag scenarios' recorder (issue #26): it listens to one press of a dragged
 * item without driving it (`@wardic/solid`'s `drag` does that), samples every frame
 * after its paint, and hands the lab one `DragRunInput` per press.
 *
 * - **The press.** A `pointerdown` on the item starts it. The moves and the release
 *   are read on `window` (capture phase, passive), so a pointer that leaves the item
 *   is still recorded, and flagged (before #31's fix Wardic's drag listened on the
 *   item itself and lost such a pointer). The press records its pointer (type,
 *   button, `isPrimary`), since only the Primary pointer should drag (#31), and each
 *   move its `buttons`. A move with no button pressed before any release means the
 *   release happened where the page never heard it (outside the window: headless
 *   Firefox sent no pointerup there in #31's checks): it counts as the release, lost.
 * - **A lost release (#31).** With the scenario's "lose the next release" toggle armed,
 *   a window capture-phase `pointerup` listener the recorder adds as it attaches, so
 *   before any listener a press adds (its own, and Wardic's window listener after
 *   #31's fix), swallows the press's pointerup (`stopImmediatePropagation`) and
 *   disarms the toggle. The run records `releaseLost` and still records `releaseAt`.
 * - **The frames.** Its own rAF loop counts Refresh frames and posts a message from
 *   each callback. The message handler runs after that frame's paint and reads the
 *   item's painted box (`getBoundingClientRect`, transform included), its slot (its
 *   untransformed layout box, from `offsetLeft`/`offsetTop`/`offsetWidth`/
 *   `offsetHeight`, which transforms don't move) and each watched child's painted box,
 *   all relative to the stage's padding box. A move is stamped with the counter's
 *   value when it was handled, so which frame could first show it is exact.
 * - **Reads no frame painted.** A layout change the scenario makes from a timer can
 *   run between a frame's paint and its read, and the read then forces a layout no
 *   frame paints. The scenario calls `noteLayoutChange` just before such a change, and
 *   a read is dropped if a change was noted after its frame's rAF callback. That order
 *   is kept by a counter, not by timestamps: Firefox rounds `performance.now()` to the
 *   millisecond, so a timer just after a rAF callback often shares its timestamp. The
 *   release counts as such a change too: its task starts the release flight, and
 *   Chromium can run that input task between a frame's paint and its read (#31: a slot
 *   move and the release in the same frame read the flight's first step as a held
 *   frame 1.05 px off the pointer). A lost release changes nothing.
 * - **The end.** After the release it keeps sampling, and recording the pointer's
 *   moves (`releaseMoves`), until the item's painted box has stood still for
 *   {@link STILL_FRAMES} frames, or {@link SETTLE_MS} ms (the scenario's `settleMs`) have passed, or the next press
 *   starts, then calls `record` with which of the three it was (`endedBy`: `settled`,
 *   `timeout` or `next-press`). A run the next press cut short was still settling, so
 *   the card doesn't judge where it ended. After a lost release the gesture should end
 *   at the pointer's first unpressed move (a Stale gesture's rule A, ADR-0019), and the
 *   item stands still until then by design: the settle starts from that move, which it
 *   waits for at most {@link SETTLE_MS} ms.
 *
 * - **Scrolls (#44).** Boxes are relative to the stage, so a move's offset is too: the
 *   pointer's client offset plus the page's scroll since the down (the stage moves with
 *   the page; no layout read). A page scroll during a press is recorded as a move of
 *   the pointer by the scrolled distance, as Wardic's Held pointer treats it (ADR-0019
 *   *Amendment (Reorder)*), so the drag checks follow it. A slot is the layout box less
 *   the scroll of the ancestors between the item and the stage (offsets ignore it), so
 *   an item in a scrolled container (scenario 14) reads its slot where it paints.
 *
 * - **At rest (#144).** `recordAtRest` records a layout change the scenario makes while the
 *   item is at rest (scenario 12's X) as an at-rest run: the same frame loop and read, from
 *   the change until the item and every element it checks have stood still for
 *   {@link STILL_FRAMES} frames and the engine has no layout animation left running (a
 *   child on a slower spring can still snap at the item's landing, a frame or two after
 *   the item looks still: #144), or {@link REST_MS} ms have passed. A press, or the next
 *   change, cuts it short; it is ignored during a press. The scenario names the elements:
 *   glued ones, read for their painted box, and isolated ones (a `layoutRoot` and what's
 *   inside it), read for their painted and layout box.
 * Layouts should keep whole-pixel positions and sizes: `offsetLeft` and friends are
 * rounded, so a fractional slot would read up to half a pixel off. A border is read as
 * drawn, not as `clientLeft` rounds it (#89): at a pixel ratio that isn't whole, a 1px
 * border is drawn narrower, snapped to device pixels.
 *
 * @module
 */
import type { Box, DragBounds, DragFrame, DragMove, DragRunEnd, DragRunInput, Point } from "../lab/drag-run.ts"
import type { ReorderFrame } from "../lab/reorder-run.ts"
import type { RestFrame, RestRunEnd, RestRunInput } from "../lab/rest-run.ts"
import { currentLabScheduler } from "../probe/timeline.ts"

/** How many frames in a row the released item's box must stand still to count as settled. */
const STILL_FRAMES = 3

/** The most a release may take to settle before the recorder stops anyway, in ms. */
const SETTLE_MS = 1500

/** How far a box may move and still count as standing still, in px. */
const STILL_PX = 0.01

/** The most an at-rest run may take to stand still before the recorder stops anyway, in ms (#38's slow spring takes about 2.5 s). */
const REST_MS = 4000

/** The drag recognizer's threshold (`packages/core/src/recognizers/drag.ts`), in px. */
const DRAG_THRESHOLD_PX = 3

/** What a scenario hands {@link attachDragRecorder}. Getters, so refs can arrive late. */
export interface DragRecorderOptions {
  /** The scenario's `.stage`: every box is relative to its padding box. */
  readonly stage: () => HTMLElement | undefined
  /**
   * The dragged item, which is also where a press starts. With {@link pressArea}, the
   * item the press is on: read at each press, after the scenario's own capture-phase
   * `pointerdown` on the area has picked it.
   */
  readonly item: () => HTMLElement | undefined
  /**
   * Where a press starts, when that's any of several items (scenario 14's group); the
   * item itself when left out. Read once, at attach.
   */
  readonly pressArea?: () => HTMLElement | undefined
  /**
   * A `<Reorder>` scenario's per-frame read (optional), given the pointer's latest
   * client position (its down until it moves): stored as the frame's `reorder`.
   */
  readonly reorderFrame?: (pointer: Point) => ReorderFrame
  /**
   * The scenario's scroller (optional: an element, or the window for the page). Given,
   * each frame records whether it scrolled since the previous read (`scrolled`).
   */
  readonly scroller?: () => Element | Window | undefined
  /** The children whose glue to the item the run checks, by name. */
  readonly children: () => Readonly<Record<string, HTMLElement | undefined>>
  /**
   * Elements whose painted box each frame records, by name, and no check judges
   * (optional): a child that moves by design, like scenario 12's M, kept for the eye
   * and the saved log (#38).
   */
  readonly watched?: () => Readonly<Record<string, HTMLElement | undefined>>
  /** Elements whose painted opacity each frame records, by name (optional). */
  readonly opacity?: () => Readonly<Record<string, HTMLElement | undefined>>
  /** The scenario's mode at the grab. */
  readonly mode: () => string
  /**
   * The most the press's release may take to settle, in ms (optional, read at the grab;
   * {@link SETTLE_MS} when left out or `undefined`): scenario 13's free box (#139), whose
   * Fling decays for a few seconds before it stands still.
   */
  readonly settleMs?: () => number | undefined
  /**
   * The pressed item's constraints on its x and y, with its `dragElastic` (optional, read at the
   * grab): scenario 13's free box with its bounds box on (#140). Recorded as the run's `bounds`.
   */
  readonly bounds?: () => DragBounds | undefined
  /** The pressed item's grid, in px (optional, read at the grab): scenario 13's free box with its grid box on (#140). */
  readonly grid?: () => number | undefined
  /**
   * Called as the press goes on: `start` when the pointer first moves past the drag
   * threshold (the drag has started), `release` on the pointerup, `end` once the run
   * is recorded.
   */
  readonly onPhase?: (phase: "start" | "release" | "end") => void
  /** Hands the lab the press (the scenario passes `ctx.recordDragRun`). */
  readonly record: (input: DragRunInput) => void
  /**
   * The scenario's "lose the next release" toggle (#31): whether it is armed, and how
   * to disarm it once a release is lost. Given, the recorder swallows the pointerup
   * that ends a press of the item while it is armed (see the module doc), as the
   * regression tests' `loseNextRelease` (`packages/solid/test/browser-helpers.ts`) does,
   * only for this item's press.
   */
  readonly loseNextRelease?: { readonly armed: () => boolean; readonly disarm: () => void }
  /**
   * Whether the item's own layout animation is running at a press (optional; scenario 13
   * after Z or P at rest). Given and true, the run records the item's slot at the press
   * (`grabFlight`), and the card judges the drag from where that flight lands (#30).
   */
  readonly flyingAtPress?: () => boolean
  /**
   * At-rest runs (#144; optional): the elements one checks, by name, and where it goes (the
   * scenario passes `ctx.recordRestRun`). Given, {@link DragRecorder.recordAtRest} records one.
   */
  readonly atRest?: {
    /** Elements that should ride the item through its layout animation. */
    readonly glued: () => Readonly<Record<string, HTMLElement | undefined>>
    /** Elements that should sit at their new place from the first frame (a `layoutRoot` and what's inside it). */
    readonly isolated: () => Readonly<Record<string, HTMLElement | undefined>>
    /** Whether the engine has no layout animation running (the scenario follows `ctx.onLayoutAnimationComplete`). */
    readonly engineIdle: () => boolean
    /** Glued elements to leave out of a run starting now, with why (optional; read once, at the start). */
    readonly leftOut?: () => Readonly<Record<string, string>>
    readonly record: (input: RestRunInput) => void
  }
}

/**
 * How far `el`'s padding box sits in from its border box's top-left corner, as drawn: `clientLeft` and
 * `clientTop` with their border part as the computed width, not rounded (#89). A border snaps to device
 * pixels, so at a 1.35 pixel ratio a 1px one is drawn 0.740741 css px wide, where `clientLeft` says 1:
 * every box read through it was 0.26 px off per bordered level (0.53 px in scenario 14's container).
 * Whatever else `clientLeft` counts (a scrollbar on the left) stays as it reads.
 */
export const insetOf = (el: HTMLElement): Point => {
  const style = getComputedStyle(el)
  const left = Number.parseFloat(style.borderLeftWidth)
  const top = Number.parseFloat(style.borderTopWidth)
  return { x: el.clientLeft - Math.round(left) + left, y: el.clientTop - Math.round(top) + top }
}

/** `el`'s painted box relative to `stage`'s padding box. */
const paintedBox = (el: Element, stage: HTMLElement): Box => {
  const r = el.getBoundingClientRect()
  const s = stage.getBoundingClientRect()
  const inset = insetOf(stage)
  return { x: r.left - s.left - inset.x, y: r.top - s.top - inset.y, width: r.width, height: r.height }
}

/**
 * `el`'s layout box, which transforms don't move, relative to `stage`'s padding box: its
 * offsets, less the scroll of the ancestors between it and the stage (offsets ignore it).
 */
const layoutBox = (el: HTMLElement, stage: HTMLElement): Box => {
  let x = 0
  let y = 0
  for (let at = el.parentElement; at !== null && at !== stage; at = at.parentElement) {
    x -= at.scrollLeft
    y -= at.scrollTop
  }
  let at: HTMLElement | null = el
  while (at !== null && at !== stage) {
    x += at.offsetLeft
    y += at.offsetTop
    const parent = at.offsetParent as HTMLElement | null
    if (parent !== null && parent !== stage) {
      const inset = insetOf(parent)
      x += inset.x
      y += inset.y
    }
    at = parent
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight }
}

/**
 * `el`'s own translation, as its computed transform has it: its x and y, exactly. Its painted box
 * less its layout box reads up to about 0.7 px off where the device pixel ratio isn't whole (borders
 * snap to device pixels, and the offsets round), more than a constrained item's checks allow (#140).
 */
const translateOf = (el: Element): Point => {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
  return { x: m.m41, y: m.m42 }
}

/** What {@link attachDragRecorder} returns. */
export interface DragRecorder {
  /** Tell the recorder a layout change is about to be made from outside a frame (see the module doc). */
  readonly noteLayoutChange: () => void
  /** Whether a press of the item is on (down, not yet released): a scenario's keys act only then. */
  readonly pressing: () => boolean
  /** The recorder's frame counter now, to stamp a scenario's own events (scenario 14's reorders). */
  readonly currentFrame: () => number
  /**
   * Starts an at-rest run (#144) for a layout change the scenario makes at rest: call it just
   * before the change, in the same task, with what makes it (`X`). Ignored during a press, or
   * with no `atRest` option; it cuts short one still recording. Whether it started.
   */
  readonly recordAtRest: (trigger: string) => boolean
  /** Stop listening (for `onCleanup`). */
  readonly detach: () => void
}

/** Attaches the recorder to a scenario's item. Call it once the View has mounted (an `onMount`). */
export const attachDragRecorder = (opts: DragRecorderOptions): DragRecorder => {
  let press:
    | {
        readonly pointerId: number
        readonly downX: number
        readonly downY: number
        /** The pointer's latest client position. */
        pointer: Point
        /** The page's scroll at the down: a move's offset adds the page's scroll since. */
        readonly scrollAtDown: Point
        /** The latest move's buttons, for a scroll's move. */
        buttons: number
        readonly input: {
          scenarioId: string
          mode: string
          grabAt: number
          grabBox: Box
          moves: Array<DragMove>
          releaseMoves: Array<DragMove>
          pointer: { type: string; button: number; isPrimary: boolean }
          frames: Array<DragFrame>
          childOffsets: Record<string, Point>
          releaseAt: number | null
          releaseLost?: boolean
          endedAt: number
          endedBy?: DragRunEnd
          pointerLeft?: boolean
          scheduler: "default" | "microtask"
          bounds?: DragBounds
          grid?: number
          grabTranslate?: Point
        }
        /** Whether the press is the Primary pointer's: only its drag starts the scenario's `start` phase. */
        readonly primary: boolean
        started: boolean
        still: number
        /** When the gesture should end: the release, or a lost release's first unpressed move (unset until then). */
        endAt: number | undefined
        /** The most its release may take to settle, in ms. */
        readonly settleMs: number
      }
    | undefined
  let frame = 0
  let frameAt = 0
  let rafId = 0
  /**
   * The current frame loop. A tick posts it, and the read drops a message from an earlier
   * loop: one in flight when a new press began would otherwise arm a second loop, which
   * reads every frame twice (and three still reads come at once after a release).
   */
  let loop = 0
  /** The scroller's scroll at the previous read, for `scrolled`. */
  let lastScroll: Point | undefined
  const scrollOf = (): Point | undefined => {
    const s = opts.scroller?.()
    if (s === undefined) return undefined
    return s instanceof Element ? { x: s.scrollLeft, y: s.scrollTop } : { x: s.scrollX, y: s.scrollY }
  }
  /** How many layout changes have been noted, and how many had been by the last rAF callback. */
  let changes = 0
  let changesAtTick = 0
  const channel = new MessageChannel()
  /** An at-rest run being recorded (#144). */
  let rest:
    | {
        readonly input: {
          scenarioId: string
          trigger: string
          startedAt: number
          slotBefore: Box
          gluedOffsets: Record<string, Point>
          leftOut?: Readonly<Record<string, string>>
          frames: Array<RestFrame>
          endedAt: number
          endedBy: RestRunEnd
          scheduler: "default" | "microtask"
        }
        still: number
      }
    | undefined

  const boxesOf = (named: Readonly<Record<string, HTMLElement | undefined>>, stage: HTMLElement): Record<string, Box> => {
    const out: Record<string, Box> = {}
    for (const [name, el] of Object.entries(named)) if (el !== undefined) out[name] = paintedBox(el, stage)
    return out
  }

  const finish = (endedBy: DragRunEnd): void => {
    const p = press
    press = undefined
    loop += 1
    cancelAnimationFrame(rafId)
    window.removeEventListener("pointermove", onMove, true)
    window.removeEventListener("scroll", onScroll, true)
    if (p === undefined) return
    p.input.endedAt = performance.now()
    p.input.endedBy = endedBy
    opts.record(p.input)
    opts.onPhase?.("end")
  }

  /** Ends the at-rest run being recorded, if one is, and hands it to the scenario. */
  const finishRest = (endedBy: RestRunEnd): void => {
    const r = rest
    rest = undefined
    if (r === undefined) return
    loop += 1
    cancelAnimationFrame(rafId)
    r.input.endedAt = performance.now()
    r.input.endedBy = endedBy
    opts.atRest?.record(r.input)
  }

  /** Whether every box stood still between two at-rest frames. */
  const restStill = (a: RestFrame, b: RestFrame): boolean => {
    const near = (p: Box, q: Box | undefined): boolean =>
      q !== undefined && Math.abs(p.x - q.x) < STILL_PX && Math.abs(p.y - q.y) < STILL_PX
    return (
      near(b.d, a.d) &&
      Object.entries(b.glued).every(([name, box]) => near(box, a.glued[name])) &&
      Object.entries(b.isolated).every(([name, at]) => near(at.painted, a.isolated[name]?.painted))
    )
  }

  /** One at-rest frame's read, after its paint. */
  const readRest = (): void => {
    const r = rest
    const at = opts.atRest
    const stage = opts.stage()
    const item = opts.item()
    if (r === undefined || at === undefined || stage === undefined || item === undefined) return
    if (!item.isConnected) {
      finishRest("removed")
      return
    }
    if (changes !== changesAtTick) {
      // A layout change landed between this frame's paint and this read: skip the read.
      rafId = requestAnimationFrame(tick)
      return
    }
    const isolated: Record<string, { painted: Box; layout: Box }> = {}
    for (const [name, el] of Object.entries(at.isolated())) {
      if (el !== undefined) isolated[name] = { painted: paintedBox(el, stage), layout: layoutBox(el, stage) }
    }
    const sample: RestFrame = {
      frame,
      frameAt,
      t: performance.now(),
      d: paintedBox(item, stage),
      slot: layoutBox(item, stage),
      glued: boxesOf(at.glued(), stage),
      isolated,
    }
    const prev = r.input.frames[r.input.frames.length - 1]
    r.input.frames.push(sample)
    r.still = prev !== undefined && restStill(prev, sample) ? r.still + 1 : 0
    const settled = r.still >= STILL_FRAMES && at.engineIdle()
    if (settled || performance.now() - r.input.startedAt > REST_MS) {
      finishRest(settled ? "settled" : "timeout")
      return
    }
    rafId = requestAnimationFrame(tick)
  }

  channel.port1.onmessage = (e: MessageEvent<number>) => {
    if (e.data !== loop) return
    if (press === undefined && rest !== undefined) {
      readRest()
      return
    }
    const p = press
    const stage = opts.stage()
    const item = opts.item()
    if (p === undefined || stage === undefined || item === undefined) return
    // The item left the page (scenario 13's boxes remount it): its boxes would read 0x0 from
    // here, so the run ends, cut short, as a next press would end it.
    if (!item.isConnected) {
      finish("removed")
      return
    }
    if (changes !== changesAtTick) {
      // A layout change landed between this frame's paint and this read: skip the read.
      rafId = requestAnimationFrame(tick)
      return
    }
    const d = paintedBox(item, stage)
    const opacities = opts.opacity?.()
    const scroll = scrollOf()
    const scrolled = scroll !== undefined && lastScroll !== undefined && (scroll.x !== lastScroll.x || scroll.y !== lastScroll.y)
    lastScroll = scroll
    const sample: DragFrame = {
      frame,
      frameAt,
      t: performance.now(),
      d,
      slot: layoutBox(item, stage),
      // A free item with constraints or a grid (#140): its x and y as its own transform has them.
      ...(p.input.bounds === undefined && p.input.grid === undefined ? {} : { translate: translateOf(item) }),
      children: boxesOf(opts.children(), stage),
      ...(opts.reorderFrame === undefined ? {} : { reorder: opts.reorderFrame(p.pointer) }),
      ...(scroll === undefined ? {} : { scrolled }),
      ...(opts.watched === undefined ? {} : { watched: boxesOf(opts.watched(), stage) }),
      ...(opacities === undefined
        ? {}
        : {
            opacity: Object.fromEntries(
              Object.entries(opacities)
                .filter((e): e is [string, HTMLElement] => e[1] !== undefined)
                .map(([name, el]) => [name, Number(getComputedStyle(el).opacity)]),
            ),
          }),
    }
    const prev = p.input.frames[p.input.frames.length - 1]
    p.input.frames.push(sample)
    if (p.input.releaseAt !== null) {
      // Until a lost release's first unpressed move the item stands still by design.
      const still =
        p.endAt !== undefined &&
        prev !== undefined &&
        Math.abs(prev.d.x - d.x) < STILL_PX &&
        Math.abs(prev.d.y - d.y) < STILL_PX
      p.still = still ? p.still + 1 : 0
      const settled = p.still >= STILL_FRAMES
      if (settled || performance.now() - (p.endAt ?? p.input.releaseAt) > p.settleMs) {
        finish(settled ? "settled" : "timeout")
        return
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  const tick = (): void => {
    frame += 1
    frameAt = performance.now()
    changesAtTick = changes
    channel.port2.postMessage(loop)
  }

  /** Records the press's release (`lost`: it never reached the page's listeners); the moves go on being recorded. */
  const release = (p: NonNullable<typeof press>, e: PointerEvent, lost: boolean): void => {
    p.input.releaseAt = performance.now()
    if (lost) p.input.releaseLost = true
    else {
      p.endAt = p.input.releaseAt
      // The release's task starts the flight: a read after it paints no frame before it.
      changes += 1
    }
    const item = opts.item()
    if (item !== undefined && !(e.target instanceof Node && item.contains(e.target))) p.input.pointerLeft = true
    window.removeEventListener("pointerup", onUp, true)
    window.removeEventListener("pointercancel", onUp, true)
    opts.onPhase?.("release")
  }

  /** A move of the press's pointer to client `(x, y)`: its offset from the down, in the stage's frame. */
  const moveOf = (p: NonNullable<typeof press>, x: number, y: number, buttons: number): DragMove => ({
    t: performance.now(),
    frame,
    dx: x - p.downX + (window.scrollX - p.scrollAtDown.x),
    dy: y - p.downY + (window.scrollY - p.scrollAtDown.y),
    buttons,
  })

  /** A page scroll during a press: the pointer moved on the page by the scrolled distance. */
  const onScroll = (e: Event): void => {
    const p = press
    if (p === undefined || (e.target !== document && e.target !== window)) return
    const move = moveOf(p, p.pointer.x, p.pointer.y, p.buttons)
    if (p.input.releaseAt !== null) p.input.releaseMoves.push(move)
    else p.input.moves.push(move)
  }

  const onMove = (e: PointerEvent): void => {
    const p = press
    if (p === undefined || e.pointerId !== p.pointerId) return
    const move = moveOf(p, e.clientX, e.clientY, e.buttons)
    p.pointer = { x: e.clientX, y: e.clientY }
    p.buttons = e.buttons
    if (p.input.releaseAt === null && e.buttons === 0) {
      // Released where the page never heard it (outside the window, where headless
      // Firefox sent no pointerup): this move is the release, lost, and the first
      // unpressed move after it.
      release(p, e, true)
    }
    if (p.input.releaseAt !== null) {
      p.input.releaseMoves.push(move)
      if (p.endAt === undefined && e.buttons === 0) p.endAt = move.t
      return
    }
    p.input.moves.push(move)
    const item = opts.item()
    if (item !== undefined && !(e.target instanceof Node && item.contains(e.target))) p.input.pointerLeft = true
    if (p.primary && !p.started && Math.hypot(move.dx, move.dy) > DRAG_THRESHOLD_PX) {
      p.started = true
      opts.onPhase?.("start")
    }
  }

  const onUp = (e: PointerEvent): void => {
    const p = press
    if (p === undefined || e.pointerId !== p.pointerId || p.input.releaseAt !== null) return
    release(p, e, false)
  }

  /** The "lose the next release" toggle's listener, added before any press (see the module doc). */
  const onLoseUp = (e: PointerEvent): void => {
    const p = press
    const lose = opts.loseNextRelease
    if (lose === undefined || !lose.armed() || p === undefined || e.pointerId !== p.pointerId || p.input.releaseAt !== null) {
      return
    }
    e.stopImmediatePropagation()
    lose.disarm()
    release(p, e, true)
  }

  /** No context menu on the item, so a right-button press (hand run R11) can be held and moved. */
  const onContextMenu = (e: Event): void => {
    e.preventDefault()
  }

  const onDown = (e: PointerEvent): void => {
    // A new press while the last one's release is still settling ends that recording
    // first (cut short), so each press is its own run, and so does one while an at-rest
    // run records. A second pointer during a press is ignored.
    finishRest("next-press")
    if (press !== undefined && press.input.releaseAt !== null) finish("next-press")
    const stage = opts.stage()
    const item = opts.item()
    if (press !== undefined || stage === undefined || item === undefined) return
    const grabBox = paintedBox(item, stage)
    const childOffsets: Record<string, Point> = {}
    for (const [name, box] of Object.entries(boxesOf(opts.children(), stage))) {
      childOffsets[name] = { x: box.x - grabBox.x, y: box.y - grabBox.y }
    }
    press = {
      pointerId: e.pointerId,
      downX: e.clientX,
      downY: e.clientY,
      pointer: { x: e.clientX, y: e.clientY },
      scrollAtDown: { x: window.scrollX, y: window.scrollY },
      buttons: e.buttons,
      input: {
        scenarioId: "",
        mode: opts.mode(),
        grabAt: performance.now(),
        grabBox,
        moves: [],
        releaseMoves: [],
        pointer: { type: e.pointerType, button: e.button, isPrimary: e.isPrimary },
        frames: [],
        childOffsets,
        releaseAt: null,
        endedAt: 0,
        scheduler: currentLabScheduler(),
        ...(opts.flyingAtPress?.() === true ? { grabFlight: { slot: layoutBox(item, stage) } } : {}),
        ...((): { bounds?: DragBounds } => {
          const bounds = opts.bounds?.()
          return bounds === undefined ? {} : { bounds }
        })(),
        ...((): { grid?: number } => {
          const grid = opts.grid?.()
          return grid === undefined ? {} : { grid }
        })(),
        // With constraints or a grid, its x and y at the grab, exactly (#140; see `translateOf`).
        ...(opts.bounds?.() === undefined && opts.grid?.() === undefined ? {} : { grabTranslate: translateOf(item) }),
      },
      // Motion's `isPrimaryPointer`, as Wardic's recognizers read it after #31 (ADR-0019).
      primary: e.pointerType === "mouse" ? e.button <= 0 : e.isPrimary,
      started: false,
      still: 0,
      endAt: undefined,
      settleMs: opts.settleMs?.() ?? SETTLE_MS,
    }
    lastScroll = scrollOf()
    window.addEventListener("pointermove", onMove, { capture: true, passive: true })
    window.addEventListener("scroll", onScroll, { capture: true, passive: true })
    window.addEventListener("pointerup", onUp, { capture: true, passive: true })
    window.addEventListener("pointercancel", onUp, { capture: true, passive: true })
    rafId = requestAnimationFrame(tick)
  }

  const item = opts.pressArea?.() ?? opts.item()
  item?.addEventListener("pointerdown", onDown, { passive: true })
  item?.addEventListener("contextmenu", onContextMenu)
  if (opts.loseNextRelease !== undefined) window.addEventListener("pointerup", onLoseUp, { capture: true, passive: true })
  return {
    noteLayoutChange: () => {
      changes += 1
    },
    pressing: () => press !== undefined && press.input.releaseAt === null,
    currentFrame: () => frame,
    recordAtRest: (trigger) => {
      const at = opts.atRest
      const stage = opts.stage()
      const item = opts.item()
      if (at === undefined || press !== undefined || stage === undefined || item === undefined) return false
      finishRest("next-change")
      const d = paintedBox(item, stage)
      const leftOut = at.leftOut?.() ?? {}
      const gluedOffsets: Record<string, Point> = {}
      for (const [name, box] of Object.entries(boxesOf(at.glued(), stage))) {
        if (!(name in leftOut)) gluedOffsets[name] = { x: box.x - d.x, y: box.y - d.y }
      }
      rest = {
        input: {
          scenarioId: "",
          trigger,
          startedAt: performance.now(),
          slotBefore: layoutBox(item, stage),
          gluedOffsets,
          ...(Object.keys(leftOut).length === 0 ? {} : { leftOut }),
          frames: [],
          endedAt: 0,
          endedBy: "settled",
          scheduler: currentLabScheduler(),
        },
        still: 0,
      }
      // The change comes next, in this task: a read already on its way paints no frame of it.
      changes += 1
      rafId = requestAnimationFrame(tick)
      return true
    },
    detach: () => {
      item?.removeEventListener("pointerdown", onDown)
      item?.removeEventListener("contextmenu", onContextMenu)
      window.removeEventListener("pointerup", onLoseUp, true)
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onUp, true)
      loop += 1
      cancelAnimationFrame(rafId)
      channel.port1.close()
      press = undefined
      rest = undefined
    },
  }
}
