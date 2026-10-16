/**
 * Scenario 14's keyboard reorder runs (#43, ADR-0037): one run per lift, recorded from what a
 * screen reader would hear, so it reads Wardic only from outside, as the drag recorder does.
 *
 * - **The run.** The page's live region saying "Picked up …" starts it, on the item that has
 *   focus. Every announcement until its end is kept, in order. "Dropped …" or "Cancelled …" is its
 *   release; from there it keeps sampling until the lifted item and its siblings have stood still
 *   for {@link STILL_FRAMES} frames, or {@link SETTLE_MS} ms have passed, or the next lift starts
 *   (`endedBy`: `settled`, `timeout`, `next-press`; `removed` if the item left the page).
 * - **The frames.** Its own rAF loop, read after each frame's paint (a `MessageChannel` message
 *   posted from the rAF callback), as the drag recorder reads: the lifted item's painted box and
 *   slot (relative to `stage`), and the scenario's reorder read with the lifted item's centre as
 *   the pointer, so the card's `raised` line asks whether the lifted item is on top there.
 * - **Focus.** Whether focus stayed on the lifted item from its lift to its release.
 *
 * Default wording only: the scenario overrides no announcement.
 *
 * @module
 */
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import type { Box, DragFrame, DragRunEnd, Point } from "../lab/drag-run.ts"
import type { ReorderFrame } from "../lab/reorder-run.ts"
import { layoutBox, paintedBox } from "./drag-recorder.ts"

/** How many frames in a row the lifted item and its siblings must stand still, after its release, to count as settled. */
const STILL_FRAMES = 3

/** How far a box may move and still count as standing still, in px. */
const STILL_PX = 0.01

/** The most a run may take to settle after its release, in ms. */
const SETTLE_MS = 1500

/** One keyboard reorder's run, for the scenario to turn into its drag run input. */
export interface KeyboardRun {
  readonly dragged: string
  readonly grabAt: number
  readonly grabBox: Box
  readonly frames: ReadonlyArray<DragFrame>
  readonly releaseAt: number | null
  readonly endedAt: number
  readonly endedBy: DragRunEnd
  readonly announced: ReadonlyArray<string>
  readonly focusKept: boolean
}

/** What a scenario hands {@link attachKeyboardRecorder}. Getters, so refs can arrive late. */
export interface KeyboardRecorderOptions {
  /** The frame every box is read relative to (the stage, or the card). */
  readonly stage: () => HTMLElement | undefined
  /** The group: the lifted item is the focused element's `[data-value]` inside it. */
  readonly group: () => HTMLElement | undefined
  /** The scenario's per-frame reorder read, given a client point (the lifted item's centre). */
  readonly reorderFrame: (pointer: Point) => ReorderFrame
  /** A lift began on `dragged`: the scenario gathers its own data for the run. */
  readonly onLift: (dragged: string) => void
  /** Hands the scenario the finished run. */
  readonly record: (run: KeyboardRun) => void
}

const sameBox = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) <= STILL_PX && Math.abs(a.y - b.y) <= STILL_PX && Math.abs(a.width - b.width) <= STILL_PX && Math.abs(a.height - b.height) <= STILL_PX

/** Whether every item's box in `a` is where it is in `b`. */
const sameItems = (a: ReorderFrame, b: ReorderFrame): boolean =>
  Object.entries(a.items).every(([value, box]) => {
    const other = b.items[value]
    return other !== undefined && sameBox(box, other)
  })

/** Attach the recorder; it records until `detach`. */
export const attachKeyboardRecorder = (opts: KeyboardRecorderOptions): { readonly detach: () => void; readonly currentFrame: () => number } => {
  interface Recording {
    readonly dragged: string
    readonly item: HTMLElement
    readonly grabAt: number
    readonly grabBox: Box
    readonly frames: Array<DragFrame>
    readonly announced: Array<string>
    releaseAt: number | null
    focusKept: boolean
    still: number
  }
  let run: Recording | undefined
  let frame = 0
  let frameAt = 0
  let rafId: number | undefined
  const channel = new MessageChannel()

  const finish = (endedBy: DragRunEnd): void => {
    const r = run
    if (r === undefined) return
    run = undefined
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    rafId = undefined
    opts.record({
      dragged: r.dragged,
      grabAt: r.grabAt,
      grabBox: r.grabBox,
      frames: r.frames,
      releaseAt: r.releaseAt,
      endedAt: performance.now(),
      endedBy,
      announced: r.announced,
      focusKept: r.focusKept,
    })
  }

  const tick = (t: number): void => {
    frame++
    frameAt = t
    channel.port2.postMessage(undefined)
  }

  // The post-paint read of each frame.
  channel.port1.onmessage = () => {
    const r = run
    const stage = opts.stage()
    if (r === undefined || stage === undefined) return
    if (!r.item.isConnected) {
      finish("removed")
      return
    }
    const rect = r.item.getBoundingClientRect()
    const sample: DragFrame = {
      frame,
      frameAt,
      t: performance.now(),
      d: paintedBox(r.item, stage),
      slot: layoutBox(r.item, stage),
      children: {},
      reorder: opts.reorderFrame({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
    }
    const prev = r.frames[r.frames.length - 1]
    r.frames.push(sample)
    if (r.releaseAt === null) {
      if (r.item.ownerDocument.activeElement !== r.item) r.focusKept = false
    } else {
      const still = prev !== undefined && sameBox(prev.d, sample.d) && prev.reorder !== undefined && sample.reorder !== undefined && sameItems(prev.reorder, sample.reorder)
      r.still = still ? r.still + 1 : 0
      if (r.still >= STILL_FRAMES) return finish("settled")
      if (performance.now() - r.releaseAt > SETTLE_MS) return finish("timeout")
    }
    rafId = requestAnimationFrame(tick)
  }

  const onAnnouncement = (text: string): void => {
    if (text.startsWith("Picked up")) {
      if (run !== undefined) finish("next-press")
      const group = opts.group()
      const stage = opts.stage()
      const focused = group?.ownerDocument.activeElement
      const item = focused instanceof HTMLElement && group?.contains(focused) === true ? focused.closest<HTMLElement>("[data-value]") : null
      if (item === null || stage === undefined) return
      const dragged = item.dataset.value ?? ""
      opts.onLift(dragged)
      run = { dragged, item, grabAt: performance.now(), grabBox: paintedBox(item, stage), frames: [], announced: [text], releaseAt: null, focusKept: true, still: 0 }
      rafId = requestAnimationFrame(tick)
      return
    }
    const r = run
    if (r === undefined) return
    r.announced.push(text)
    if (r.releaseAt === null && (text.startsWith("Dropped") || text.startsWith("Cancelled"))) r.releaseAt = performance.now()
  }

  // The live region: Wardic adds it when a group with the keyboard reorder attaches, so it's there by now,
  // or within a few frames.
  let observer: MutationObserver | undefined
  let waitId: number | undefined
  const observe = (tries: number): void => {
    const region = document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)
    if (region === null) {
      if (tries > 0) waitId = requestAnimationFrame(() => observe(tries - 1))
      return
    }
    observer = new MutationObserver(() => onAnnouncement((region.textContent ?? "").replace(/ $/, "")))
    observer.observe(region, { childList: true, characterData: true, subtree: true })
  }
  observe(60)

  return {
    currentFrame: () => frame,
    detach: () => {
      observer?.disconnect()
      if (waitId !== undefined) cancelAnimationFrame(waitId)
      if (rafId !== undefined) cancelAnimationFrame(rafId)
      channel.port1.close()
      run = undefined
    },
  }
}
