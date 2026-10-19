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
 *   or **returns**: it never stood still.
 * - **same frame** (the swipe card): a key derived from another's output paints with it: each
 *   frame, the derived key's painted value is what the mapping gives for the other's painted value.
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
}

/** The lines a live run can be judged on, in display order. */
export const LIVE_CHECK_NAMES = ["follows", "wins", "returns", "same frame"] as const
export type LiveCheckName = (typeof LIVE_CHECK_NAMES)[number]

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
}

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

const followsOf = (s: LiveSeries): LiveCheck => {
  if (s.cut === true) return { name: "follows", ok: true, text: "cut off while its value still moved, not judged" }
  const rest = s.frames.filter((f) => f.phase === "rest")
  const after = s.frames.filter((f) => f.phase === "after")
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
  const pairs = s.frames.filter((f) => f.derived !== undefined && f.expected !== undefined)
  if (pairs.length === 0) return line("same frame", false, "no frame read", "the derived key each frame")
  const off = pairs.find((f) => Math.abs(f.derived! - f.expected!) > s.tolerance)
  if (off !== undefined) return line("same frame", false, `${fmt(off.derived!)} at ${fmt(off.expected!)}`, `within ${s.tolerance}`)
  return line("same frame", true, `with it, ${pairs.length} frames`, "")
}

const checkOf: Readonly<Record<LiveCheckName, (s: LiveSeries) => LiveCheck>> = {
  follows: followsOf,
  wins: winsOf,
  returns: returnsOf,
  "same frame": sameFrameOf,
}

/** A live run's lines (see the module doc): the ones its cell names, in display order. */
export const liveChecksOf = (input: BoardRunInput): Array<LiveCheck> => {
  const s = input.live
  if (s === undefined) return []
  return LIVE_CHECK_NAMES.filter((name) => s.lines.includes(name)).map((name) => checkOf[name](s))
}
