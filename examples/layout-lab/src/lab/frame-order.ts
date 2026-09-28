/**
 * Issues #2 and #18: turns a run's frame-trace records into Refresh frames, each
 * with the order its callbacks ran in, and joins each input to the first Refresh
 * frame that ran after it.
 *
 * A Refresh frame is one run of the HTML Standard's "run the animation frame
 * callbacks", which invokes every callback of the frame with the same `now` (see
 * {@link groupFrames} for why the timestamp alone doesn't identify a frame). A
 * frame's `order` names its callbacks' tags in run order, then its ResizeObserver
 * deliveries after a `|`, e.g.
 * `ticker>gate>clock|engine-ro`: the lab's ticker ran first, then the gate's flush,
 * then the Clock's tick, and after them the projection engine's observer
 * delivered.
 *
 * Pure (no DOM), so the node test tier imports it (`test/frame-order.test.ts`).
 *
 * @module
 */
import type { InputRecord, ObserverRecord, RafRecord } from "../probe/frame-trace.ts"

/** One Refresh frame: one run of rAF callbacks, in run order. */
export interface RefreshFrame {
  /** The timestamp the browser passed every callback of this frame (Firefox can repeat it in the next one). */
  readonly frameTs: number
  /** When the frame's first callback started (`performance.now()`, ms). */
  readonly firstStart: number
  /** The callbacks' tags in run order joined by `>`, then `|` and the frame's ResizeObserver tags, if any. */
  readonly order: string
  /** The frame's callbacks, in run order. */
  readonly callbacks: ReadonlyArray<RafRecord>
}

/** An input, with the first Refresh frame whose callbacks started after it was handled. */
export interface InputJoin extends InputRecord {
  /** That frame's timestamp, or `null` when no traced frame started after the input. */
  readonly frameTs: number | null
  /** When that frame's first callback started, or `null`. */
  readonly frameStart: number | null
  /** That frame's `order`, or `null`. */
  readonly order: string | null
}

/**
 * Groups `callbacks` into Refresh frames, oldest first, each frame's callbacks in
 * run order. Order is by `seq`, never by time: Firefox's whole-millisecond
 * `performance.now()` can give two callbacks, or a callback and an input, the same
 * time.
 *
 * A frame is a run of callbacks that share a timestamp and were all requested
 * before its first callback started. The second test matters: Firefox can run a
 * second Refresh frame right after an input and pass it the previous frame's
 * timestamp, and the HTML Standard snapshots a frame's callbacks when it begins, so
 * a callback requested during a frame always belongs to a later one.
 *
 * An observer delivery joins the last frame whose first callback started before it
 * (deliveries run after the frame's rAF callbacks); one before every frame is in
 * no frame's order.
 */
export const groupFrames = (
  callbacks: ReadonlyArray<RafRecord>,
  observers: ReadonlyArray<ObserverRecord>,
): ReadonlyArray<RefreshFrame> => {
  const groups: Array<Array<RafRecord>> = []
  let current: Array<RafRecord> | undefined
  for (const record of [...callbacks].sort((a, b) => a.seq - b.seq)) {
    const first = current?.[0]
    if (current === undefined || first === undefined || record.frameTs !== first.frameTs || record.requestSeq > first.seq) {
      current = [record]
      groups.push(current)
    } else {
      current.push(record)
    }
  }
  const delivered = groups.map((): Array<ObserverRecord> => [])
  for (const record of [...observers].sort((a, b) => a.seq - b.seq)) {
    let owner = -1
    for (let i = 0; i < groups.length && groups[i][0].seq < record.seq; i++) owner = i
    if (owner >= 0) delivered[owner].push(record)
  }
  return groups.map((records, i) => {
    const rafOrder = records.map((r) => r.tag).join(">")
    const observerTags = delivered[i].map((r) => r.tag).join(">")
    return {
      frameTs: records[0].frameTs,
      firstStart: records[0].start,
      order: observerTags === "" ? rafOrder : `${rafOrder}|${observerTags}`,
      callbacks: records,
    }
  })
}

/**
 * Joins each input to the first frame whose first callback started after the input
 * was handled (by `seq`): the Refresh frame that could first show what the handler
 * did. Joining on the frame's timestamp instead would be wrong in Chromium, which
 * stamps rAF with the frame's begin time (ADR-0017), so an input handled after
 * that moment but before the frame's callbacks carries a later time than the
 * frame's own timestamp. Joining on times would tie in Firefox (whole ms).
 */
export const joinInputs = (
  inputs: ReadonlyArray<InputRecord>,
  frames: ReadonlyArray<RefreshFrame>,
): ReadonlyArray<InputJoin> =>
  inputs.map((input) => {
    const next = frames.find((frame) => frame.callbacks[0].seq > input.seq)
    return next === undefined
      ? { ...input, frameTs: null, frameStart: null, order: null }
      : { ...input, frameTs: next.frameTs, frameStart: next.firstStart, order: next.order }
  })
