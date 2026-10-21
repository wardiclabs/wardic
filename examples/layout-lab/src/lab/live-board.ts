/**
 * Scenario 18's live runs (#130, ADR-0043): each gesture on a cell whose key has a **Live value** in
 * `style` is one board run of kind `live`. Its `live` series has, each painted frame, the key's
 * painted value (`shown`), the value it should follow (`live`: the Live value set before that
 * frame), and the phase: `rest` before the gesture, `held` while a gesture or an animation sets the
 * key, `after` from its end. It's judged on the lines its cell names:
 *
 * - **follows**: at rest the element shows its Live value: every `rest` frame, and every `after`
 *   frame from its landing on, within the tolerance of `live`. Each change paints in the frame after
 *   it's made, so a frame behind is off by the change.
 * - **wins**: while a gesture or an animation sets the key, it shows that value, not the Live
 *   value, however the Live value moves meanwhile. Once a `held` frame reaches `held`, every later
 *   one stays there. A press let go before it got there (a phone's short press) is judged on its
 *   way: each `held` frame no further from `held` than the one before, and not on the Live value, so a
 *   Live value that pulled it back, or that it showed, fails.
 * - **returns**: from the gesture's end it goes back to the Live value with no jump (no step
 *   between two frames over the cell's `maxStep`), and lands on it: from some frame on, every frame
 *   is on it. A spring return chases a value that keeps moving, landing once it slows; a tween return
 *   lands on it at its end.
 * - A run the recorder cut off while its Live value still moved (`cut`) isn't judged on **follows**
 *   or **returns**: it never stood still. Nor is one the cell's next gesture cut short before it
 *   landed (`superseded`): that gesture's run takes over from there (#209 PR 5b, found by hand).
 * - **same frame** (the swipe card): a key derived from another's output paints with it: each
 *   frame, the derived key's painted value is what the mapping gives for the other's painted value.
 *
 * Scenario 19's lines (#234, #233):
 *
 * - **moves** (the velocity skew): while the Live value moves, the key moves off its rest: on at
 *   least half the frames whose Live value changed since the frame before.
 * - **settles**: once the Live value stops, the key is back at its rest within {@link SETTLE_FRAMES}
 *   frames, and stays there.
 * - **ticks** (the spinner): the key advances every frame, at the cell's rate within 5%: `live` is the
 *   frame's time in ms, `shown` the key's value unwrapped.
 * - **updates** (`onUpdate`): told at most once a frame, at least once in the run, and each time with
 *   the value the frame painted.
 * - **resizes** (#239, the progress bar after "Add rows"): the box's content grows with its scroll
 *   still, and the bar shows the box's new progress (`live`: read from the box itself) within
 *   {@link RESIZE_FRAMES} frames of each change, and is on it at the run's end. A content change is
 *   read after its layout, so what it moves paints a frame later. A run can hold more than one change
 *   (a second tap while it records) and scrolls between them, which the bar follows in their frame.
 *
 * A frame read late (`late`, `lab/frame-counter.ts`: a phone's read after the paint that ran after
 * the next frame started) holds two frames' reads, so follows, same frame, updates, moves and resizes
 * skip it. A run whose moving (or told) frames were mostly read late, a busy main thread's (#240's
 * phone log: frames 140 ms apart), isn't judged on moves or updates: too little is left to judge.
 *
 * Pure (no DOM), so the node test tier imports it (`test/live-board.test.ts`).
 *
 * @module
 */
import type { BoardRunInput } from "./base-values-board.ts"

/** One painted frame of a live run. */
export interface LiveFrame {
  /** The watched key's painted value. */
  readonly shown: number
  /** What it should show at rest: the Live value set before this frame. */
  readonly live: number
  readonly phase: "rest" | "held" | "after"
  /** The swipe card's derived key: its painted value, and what the mapping gives for `shown`. */
  readonly derived?: number
  readonly expected?: number
  /** `onUpdate`'s calls since the frame before (#233), and the value its last one held. */
  readonly calls?: number
  readonly updated?: number
  /**
   * Read late (`lab/frame-counter.ts`): the read after the paint ran after another frame started,
   * so it holds that frame's. Skipped by the lines that compare one frame's reads: follows, same
   * frame and updates.
   */
  readonly late?: boolean
}

/** The lines a live run can be judged on, in display order. */
export const LIVE_CHECK_NAMES = ["follows", "wins", "returns", "same frame", "moves", "settles", "ticks", "updates", "resizes"] as const
export type LiveCheckName = (typeof LIVE_CHECK_NAMES)[number]

/** Scenario 18's card lines (#130). */
export const LIVE_VALUE_LINES: ReadonlyArray<LiveCheckName> = ["follows", "wins", "returns", "same frame"]

/** Scenario 19's card lines (#234, #233). */
export const SCROLL_LINKED_LINES: ReadonlyArray<LiveCheckName> = ["follows", "moves", "settles", "ticks", "updates", "resizes"]

/** A live run's frames and how its cell judges them. */
export interface LiveSeries {
  readonly frames: ReadonlyArray<LiveFrame>
  /** The lines this cell is judged on. */
  readonly lines: ReadonlyArray<LiveCheckName>
  /** The value a gesture or an animation holds the key at, for `wins`. */
  readonly held?: number
  /** The largest step between two frames that isn't a jump, in the key's units. */
  readonly maxStep: number
  /** How near counts as on it, in the key's units. */
  readonly tolerance: number
  /** The recorder cut the run off while its Live value still moved: it never stood still. */
  readonly cut?: boolean
  /** The cell's next gesture began before this run landed, and ended it: its run takes over. */
  readonly superseded?: boolean
  /** Where the key rests while its Live value stands still, for `moves` and `settles`. Default 0. */
  readonly rest?: number
  /** The key's rate a ms, for `ticks`. */
  readonly rate?: number
}

/** The frames `settles` gives the key to be back at its rest once its Live value stops. */
export const SETTLE_FRAMES = 30

/** One card line of a live run. */
export interface LiveCheck {
  readonly name: LiveCheckName
  readonly ok: boolean
  readonly text: string
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(3))
const line = (name: LiveCheckName, ok: boolean, value: string, expected: string): LiveCheck => ({
  name,
  ok,
  text: ok ? `${value} ✓` : `${value} ✗ expected ${expected}`,
})

const isOn = (f: LiveFrame, tolerance: number): boolean => Math.abs(f.shown - f.live) <= tolerance

/** The index in `after` from which every frame is on its Live value, or `undefined` if it never lands. */
export const landingOf = (after: ReadonlyArray<LiveFrame>, tolerance: number): number | undefined => {
  let landing: number | undefined
  for (let i = after.length - 1; i >= 0; i--) {
    if (!isOn(after[i]!, tolerance)) break
    landing = i
  }
  return landing
}

/** The frames read on time: a late one holds two frames' reads. */
const onTime = (frames: ReadonlyArray<LiveFrame>): ReadonlyArray<LiveFrame> => frames.filter((f) => f.late !== true)

const followsOf = (s: LiveSeries): LiveCheck => {
  if (s.cut === true) return { name: "follows", ok: true, text: "cut off while its value still moved, not judged" }
  if (s.superseded === true) return { name: "follows", ok: true, text: "cut short by the next gesture, not judged" }
  const rest = onTime(s.frames).filter((f) => f.phase === "rest")
  const after = onTime(s.frames).filter((f) => f.phase === "after")
  const landing = landingOf(after, s.tolerance)
  const judged = [...rest, ...(landing === undefined ? [] : after.slice(landing))]
  const off = judged.find((f) => !isOn(f, s.tolerance))
  if (judged.length === 0) return line("follows", false, "no frame at rest", "frames at rest on the Live value")
  if (off !== undefined) return line("follows", false, `shows ${fmt(off.shown)} at ${fmt(off.live)}`, `within ${s.tolerance}`)
  return line("follows", true, `on it, ${judged.length} frames`, "")
}

const winsOf = (s: LiveSeries): LiveCheck => {
  const held = s.frames.filter((f) => f.phase === "held")
  if (s.held === undefined) return line("wins", false, "no held value", "a cell that holds one")
  const target = s.held
  const last = held[held.length - 1]
  if (last === undefined) return line("wins", false, "no frame held", `${target} while held`)
  const reached = held.findIndex((f) => Math.abs(f.shown - target) <= s.tolerance)
  if (reached !== -1) {
    const off = held.slice(reached).find((f) => Math.abs(f.shown - target) > s.tolerance)
    return off === undefined
      ? line("wins", true, `holds ${fmt(target)}`, "")
      : line("wins", false, `left ${fmt(target)} for ${fmt(off.shown)} while held`, `${target} while held`)
  }
  // Let go before it got there: judged on its way, never pulled back toward the Live value, and not
  // on the Live value itself (one moving toward the held value would look like the way there).
  const onLive = held.slice(1).filter((f) => Math.abs(f.live - target) > s.tolerance && Math.abs(f.shown - f.live) <= s.tolerance).length
  if (held.length > 1 && onLive >= (held.length - 1) / 2) return line("wins", false, "shows the Live value while held", `${target} while held`)
  const back = held.findIndex((f, i) => i > 0 && Math.abs(f.shown - target) > Math.abs(held[i - 1]!.shown - target) + s.tolerance)
  return back === -1
    ? line("wins", true, `let go at ${fmt(last.shown)}, on its way to ${fmt(target)}`, "")
    : line("wins", false, `pulled back to ${fmt(held[back]!.shown)} while held`, `on its way to ${target}`)
}

const returnsOf = (s: LiveSeries): LiveCheck => {
  if (s.cut === true) return { name: "returns", ok: true, text: "cut off while its value still moved, not judged" }
  if (s.superseded === true) return { name: "returns", ok: true, text: "cut short by the next gesture, not judged" }
  // From the last held frame on: no jump on the way back.
  const from = Math.max(0, s.frames.findIndex((f) => f.phase === "after") - 1)
  const way = s.frames.slice(from)
  let jump = 0
  for (let i = 1; i < way.length; i++) jump = Math.max(jump, Math.abs(way[i]!.shown - way[i - 1]!.shown))
  if (jump > s.maxStep) return line("returns", false, `jumped ${fmt(jump)}`, `steps under ${s.maxStep}`)
  const after = s.frames.filter((f) => f.phase === "after")
  const landing = landingOf(after, s.tolerance)
  if (landing === undefined || after.length - landing < 3) {
    const last = after[after.length - 1]
    return line("returns", false, `at ${last === undefined ? "?" : fmt(last.shown)}`, "landed on the Live value")
  }
  return line("returns", true, `landed in ${landing} frames, steps under ${fmt(Math.max(jump, 0))}`, "")
}

const sameFrameOf = (s: LiveSeries): LiveCheck => {
  const pairs = onTime(s.frames).filter((f) => f.derived !== undefined && f.expected !== undefined)
  if (pairs.length === 0) return line("same frame", false, "no frame read", "the derived key each frame")
  const off = pairs.find((f) => Math.abs(f.derived! - f.expected!) > s.tolerance)
  if (off !== undefined) return line("same frame", false, `${fmt(off.derived!)} at ${fmt(off.expected!)}`, `within ${s.tolerance}`)
  return line("same frame", true, `with it, ${pairs.length} frames`, "")
}

/** The index of each frame whose Live value changed since the frame before. */
const changedAt = (frames: ReadonlyArray<LiveFrame>, tolerance: number): Array<number> =>
  frames.flatMap((f, i) => (i > 0 && Math.abs(f.live - frames[i - 1]!.live) > tolerance / 2 ? [i] : []))

/** Not judged: most of the run's moving frames were read late (a phone's busy main thread, #240's log). */
const READ_LATE = "its moving frames read late (a busy main thread), not judged"

const movesOf = (s: LiveSeries): LiveCheck => {
  const rest = s.rest ?? 0
  const moving = changedAt(s.frames, s.tolerance)
  if (moving.length === 0) return line("moves", false, "its value never moved", "a run that moves it")
  // A late read holds the next frame's skew against this frame's change: judged on the frames read on time.
  const changed = moving.filter((i) => s.frames[i]!.late !== true)
  if (changed.length * 2 < moving.length) return { name: "moves", ok: true, text: READ_LATE }
  const off = changed.filter((i) => Math.abs(s.frames[i]!.shown - rest) > s.tolerance).length
  return line("moves", off * 2 >= changed.length, `off its rest on ${off} of ${changed.length} moving frames`, "half or more")
}

const settlesOf = (s: LiveSeries): LiveCheck => {
  const rest = s.rest ?? 0
  const changed = changedAt(s.frames, s.tolerance)
  const last = changed[changed.length - 1] ?? 0
  const after = s.frames.slice(last + 1)
  const back = after.findIndex((f) => Math.abs(f.shown - rest) <= s.tolerance)
  if (back === -1) return line("settles", false, `never back at ${fmt(rest)}`, `${rest} within ${SETTLE_FRAMES} frames`)
  const stays = after.slice(back).every((f) => Math.abs(f.shown - rest) <= s.tolerance)
  const ok = back <= SETTLE_FRAMES && stays
  return line("settles", ok, `back at ${fmt(rest)} ${back} frames after it stopped${stays ? "" : ", then off it"}`, `within ${SETTLE_FRAMES} frames, staying`)
}

const ticksOf = (s: LiveSeries): LiveCheck => {
  const f = s.frames
  if (f.length < 2 || s.rate === undefined) return line("ticks", false, "no frames", "a sampled run")
  const stalled = f.slice(1).filter((x, i) => x.shown <= f[i]!.shown).length
  const rate = (f[f.length - 1]!.shown - f[0]!.shown) / (f[f.length - 1]!.live - f[0]!.live)
  const ok = stalled === 0 && Math.abs(rate - s.rate) <= 0.05 * s.rate
  return line("ticks", ok, `${fmt(rate * 1000)} a second, ${stalled} frames still`, `${fmt(s.rate * 1000)} a second, every frame`)
}

const updatesOf = (s: LiveSeries): LiveCheck => {
  const told = onTime(s.frames).filter((f) => (f.calls ?? 0) > 0)
  const toldAll = s.frames.filter((f) => (f.calls ?? 0) > 0).length
  if (told.length * 2 < toldAll) return { name: "updates", ok: true, text: "told on frames read late (a busy main thread), not judged" }
  if (told.length === 0) return line("updates", false, "never told", "told each changed frame")
  const twice = told.filter((f) => (f.calls ?? 0) > 1).length
  const off = told.find((f) => f.updated === undefined || Math.abs(f.updated - f.shown) > s.tolerance)
  if (twice > 0) return line("updates", false, `told twice in ${twice} frames`, "once a frame")
  if (off !== undefined) return line("updates", false, `told ${off.updated === undefined ? "?" : fmt(off.updated)} for ${fmt(off.shown)} painted`, "the painted value")
  return line("updates", true, `told on ${told.length} frames, each with what painted`, "")
}

/** Frames a content change may take to reach what it moves (#239): the observer's delivery, a frame late, and one more. */
export const RESIZE_FRAMES = 2

const resizesOf = (s: LiveSeries): LiveCheck => {
  const frames = onTime(s.frames)
  if (frames.length === 0) return line("resizes", false, "no frame", "frames after the content changed")
  if (frames.every((f) => f.live === 0)) return line("resizes", true, "the box was at its top: its progress stays 0", "")
  // Each stretch of frames off the box's progress: one per change, each as long as the change took.
  const stretches: Array<number> = []
  let off = 0
  for (const f of frames) {
    if (isOn(f, s.tolerance)) {
      if (off > 0) stretches.push(off)
      off = 0
    } else off++
  }
  const last = frames[frames.length - 1]!
  if (off > 0) return line("resizes", false, `shows ${fmt(last.shown)} at ${fmt(last.live)} at the end`, "the box's progress")
  const longest = Math.max(0, ...stretches)
  if (longest > RESIZE_FRAMES) return line("resizes", false, `on it ${longest} frames after a change`, `within ${RESIZE_FRAMES}`)
  const changes = stretches.length
  if (changes === 0) return line("resizes", true, "on it every frame", "")
  return line("resizes", true, `${changes} change${changes === 1 ? "" : "s"}, each on it within ${longest} frame${longest === 1 ? "" : "s"}`, "")
}

const checkOf: Readonly<Record<LiveCheckName, (s: LiveSeries) => LiveCheck>> = {
  follows: followsOf,
  wins: winsOf,
  returns: returnsOf,
  "same frame": sameFrameOf,
  moves: movesOf,
  settles: settlesOf,
  ticks: ticksOf,
  updates: updatesOf,
  resizes: resizesOf,
}

/** A live run's lines (see the module doc): the ones its cell names, in display order. */
export const liveChecksOf = (input: BoardRunInput): Array<LiveCheck> => {
  const s = input.live
  if (s === undefined) return []
  return LIVE_CHECK_NAMES.filter((name) => s.lines.includes(name)).map((name) => checkOf[name](s))
}
