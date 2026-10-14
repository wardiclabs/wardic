/**
 * Scenario 16's crossfade runs (#5, ADR-0010 *Amendment (#5)*): each handover a cell starts is
 * one board run of kind `crossfade`. Its `during` is the Lead's opacity each painted frame, and its
 * `crossfade` the Follower's, from the handover until both stood still. It's judged on:
 *
 * - **covers**: the overlap is never see-through. Each frame the twins together cover at least
 *   0.98 (`1 − (1 − lead)(1 − follower)`). Motion's curves cover all of it, the Lead in by the
 *   middle and the Follower held until then; a symmetric cross-dissolve covers 0.75 at its middle.
 * - **order**: the Lead is in before its Follower fades: on the first frame the Follower reads
 *   below 0.99, the Lead reads 0.99 or more.
 * - **fades**: the Lead fades in, some frame strictly between 0 and 1. A swap with no crossfade
 *   (twins at one box before #5) fails it.
 * - **end**: the Lead at 1, and its Follower at 0 or gone.
 * - **passes** (#165), for a cell that watches it: the point at the Lead's centre never hit the
 *   Follower.
 * - **starts** (#170): the Lead goes on from where its twin was painted at the toggle. Its first
 *   frame is no further from there than its next step (plus 1.5px): a start from rest accelerates,
 *   while one from where the twin would have rested jumps the rest of the twin's flight. Measured
 *   by the furthest edge (#8), so a twin's own scale counts: a start from its box without it jumps.
 * - **lands** (#171): the Lead lands on time, on its layout transition's duration (0.45 s, Motion's
 *   default tween), within two frames of it, landed exactly on its box, and never steps back on its
 *   way: each frame no further from where it lands than the frame before, within 0.05px. A flight
 *   under 2px isn't timed: the transform as written can't resolve its last frames. Two frames, not
 *   one: a flight's first step counts a whole dt from the frame before, the nominal 1/60 s from an
 *   idle Clock, so on a display faster than 60 Hz it lands up to a frame early by the page's clock
 *   (a phone at 72 Hz: 20ms). A spring's tail crept for
 *   frames past that and could nudge back as it settled. Measured by the furthest edge, from the
 *   frame before its first sample. Not judged on a run something else moves the Lead in (a
 *   container scaling in), on one nothing moves, or on one the next run cut short.
 * - **follows** (#8): while the Follower shows, it's drawn on its Lead, within 0.5px every frame,
 *   whatever either twin's own scale.
 * - **blends** (#166), for a run that watched its twins' looks: the Lead's radius and rotation (and
 *   on a toggle back, its opacity) go on from the outgoing twin's as drawn, the first frame no
 *   further from them than the next step, and while the Follower shows it's drawn with the Lead's,
 *   within 0.75px and 0.75°.
 *
 * - **aspect** (#169), for the nested cell's containers: the `layout` badge in each keeps its own
 *   shape, within 3% of its own width-to-height ratio on every frame it's on the page. The
 *   Follower's badge counts too: a Follower's layout nodes stay corrected for its lock.
 *
 * A toggle back with no twin left to fade (`back`: the overlap and in place cells closed) is judged
 * on starts and end only, and blends when it watched its twins' looks.
 *
 * A twin translucent on purpose (#166's shaped overlap, `ownOpacity`) is judged on its crossfade
 * factor: its opacity read over its own.
 *
 * A handover that only moves, inside a crossfading container (#5), is judged on **own fade**
 * instead: its Lead at 1 on every frame, and its **end**, its Follower hidden once it's over.
 *
 * A run its cell's next handover cut short is **superseded**: what it sampled from then on was the
 * next run's, with the twins' roles swapped, so only what it saw before is judged (covers, order,
 * own fade, passes); fades and end aren't.
 *
 * Pure (no DOM), so the node test tier imports it (`test/crossfade-board.test.ts`).
 *
 * @module
 */
import type { BoardRunInput } from "./base-values-board.ts"

/** The Follower's side of a crossfade run, and what else the cell watches. */
export interface CrossfadeSeries {
  /** The Follower's opacity each frame `during` reads, or `null` once it's gone (an exit). */
  readonly follower: ReadonlyArray<number | null>
  /** Each frame, whether the point at the Lead's centre hit the Follower (#165); left out when the cell doesn't watch it. */
  readonly hitsFollower?: ReadonlyArray<boolean>
  /** A handover that only moves, inside a crossfading container (#5). */
  readonly onlyMoves?: boolean
  /**
   * Where the outgoing twin was painted at the toggle, and the Lead's first painted frames (#170):
   * top-left, and size where recorded (#8).
   */
  readonly startsFrom?: Drawn
  readonly leadPath?: ReadonlyArray<Drawn>
  /**
   * Where the Lead was drawn each frame, and when, and its layout transition's duration (#171):
   * left out when something else moves it.
   */
  readonly landing?: { readonly duration: number; readonly track: ReadonlyArray<{ readonly t: number; readonly at: Drawn }> }
  /** While the Follower shows, its furthest edge from its Lead's each frame (#8). */
  readonly follows?: ReadonlyArray<number>
  /** The outgoing twin's look as drawn at the toggle, and the twins' each frame (#166). */
  readonly lookFrom?: Look
  readonly looks?: ReadonlyArray<{ readonly lead: Look; readonly follower: Look | null }>
  /**
   * Each twin's own opacity, when one is translucent on purpose (#166's shaped twins): the lines on
   * opacity judge its crossfade factor, the opacity read over its own.
   */
  readonly ownOpacity?: { readonly lead: number; readonly follower: number }
  /** A toggle back with no twin left to fade (#170): judged on starts and end only. */
  readonly back?: boolean
  /**
   * The `layout` badges' painted width-to-height ratio each frame, in the Lead's container and the
   * Follower's (`null` once gone), and each badge's own (#169).
   */
  readonly aspects?: ReadonlyArray<{ readonly lead: number | null; readonly follower: number | null }>
  readonly ownAspects?: { readonly lead: number; readonly follower: number }
}

/** Where an element is drawn: its top-left, and its size where recorded (#8). */
export interface Drawn {
  readonly x: number
  readonly y: number
  readonly w?: number
  readonly h?: number
}

/** How an element is drawn (#166): its top-left radius in px as painted, its rotation in degrees, its opacity. */
export interface Look {
  readonly radius: number
  readonly rotate: number
  readonly opacity: number
}

/** A crossfade card's lines, in display order. */
export const CROSSFADE_CHECK_NAMES = ["starts", "lands", "follows", "blends", "covers", "order", "fades", "own fade", "aspect", "end", "passes"] as const

/** One crossfade card line. */
export interface CrossfadeCheck {
  readonly name: (typeof CROSSFADE_CHECK_NAMES)[number]
  readonly ok: boolean
  readonly text: string
}

const v3 = (v: number | null | undefined): string => (v === undefined || v === null || Number.isNaN(v) ? "?" : v.toFixed(3))
const line = (name: CrossfadeCheck["name"], ok: boolean, value: string, expected: string): CrossfadeCheck => ({
  name,
  ok,
  text: ok ? `${value} ✓` : `${value} ✗ expected ${expected}`,
})

/** The Follower's last reading, or `null` once it's gone. */
const lastOf = (xs: ReadonlyArray<number | null>): number | null | undefined => xs[xs.length - 1]

/** The starts line (#170), when the run recorded where it started from and its first two frames. */
const startsOf = (series: CrossfadeSeries | undefined): Array<CrossfadeCheck> => {
  const from = series?.startsFrom
  const path = series?.leadPath
  if (from === undefined || path === undefined || path.length < 2) return []
  const [first, second] = [path[0]!, path[1]!]
  const jump = apart(first, from)
  const step = apart(second, first)
  return [line("starts", jump <= step + 1.5, `${jump.toFixed(1)}px from its twin (next step ${step.toFixed(1)}px)`, "where its twin was painted")]
}

/**
 * How far apart two drawn boxes are: their furthest edge (#8), or their top-lefts' distance when
 * either has no size (a run recorded before #8).
 */
const apart = (a: Drawn, b: Drawn): number => {
  if (a.w === undefined || a.h === undefined || b.w === undefined || b.h === undefined) return Math.hypot(a.x - b.x, a.y - b.y)
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h))
}

/** How far a channel's first frame jumps from where its twin had it, past its next step. */
const jumpPast = (from: number, first: number, second: number): number => Math.abs(first - from) - Math.abs(second - first)

/** The blends line (#166), when the run recorded its twins' looks; `back` judges the opacity too. */
const blendsOf = (series: CrossfadeSeries | undefined, back: boolean): Array<CrossfadeCheck> => {
  const from = series?.lookFrom
  const looks = series?.looks
  if (from === undefined || looks === undefined || looks.length < 2) return []
  const [first, second] = [looks[0]!.lead, looks[1]!.lead]
  const jumps: Array<[string, number, number]> = [
    ["radius", jumpPast(from.radius, first.radius, second.radius), 0.75],
    ["tilt", jumpPast(from.rotate, first.rotate, second.rotate), 0.75],
  ]
  if (back) jumps.push(["opacity", jumpPast(from.opacity, first.opacity, second.opacity), 0.03])
  const jumped = jumps.filter(([, past, tol]) => past > tol).map(([name]) => name)
  let off = 0
  let worst = 0
  let shown = 0
  for (const { lead, follower } of looks) {
    if (follower === null || follower.opacity <= 0.01) continue
    shown++
    const apart = Math.max(Math.abs(lead.radius - follower.radius), Math.abs(lead.rotate - follower.rotate))
    worst = Math.max(worst, apart)
    if (apart > 0.75) off++
  }
  const ok = jumped.length === 0 && off === 0
  const followerText = shown === 0 ? "" : `; Follower within ${worst.toFixed(2)}`
  const text = ok
    ? `from its twin's look${back ? ", opacity too" : ""}${followerText}`
    : [jumped.length > 0 ? `jumps its twin's ${jumped.join(", ")}` : "", off > 0 ? `Follower off its look on ${off} frames` : ""].filter(Boolean).join("; ")
  return [line("blends", ok, text, "the twin's look eased into the Lead's, the Follower drawn with it")]
}

/** How far a drawn box steps back toward where it came from, past this, still counts as on its way (px). */
const BACK_TOLERANCE = 0.05
/**
 * How near where it lands a drawn box has landed (px): exactly there, past rounding. A tween is on its
 * box only at its end, and a spring once it settles; a short flight's last frames ease in under 0.01px.
 */
const LANDED_WITHIN = 1e-4
/**
 * The shortest flight timed (px): the renderer writes a transform to a few decimals, so a flight
 * under a pixel or two reads as landed frames early, and a landing that small can't be seen anyway.
 */
const TIMED_FROM = 2
/** How many frames off its duration a landing may be: its first step's dt counts from the frame before. */
const ON_TIME_FRAMES = 2

/** The lands line (#171), when the run recorded where its Lead was drawn each frame. */
const landsOf = (series: CrossfadeSeries | undefined, superseded: boolean): Array<CrossfadeCheck> => {
  const landing = series?.landing
  if (landing === undefined || landing.track.length < 3) return []
  if (superseded) return [{ name: "lands", ok: true, text: "superseded by the next run, not judged" }]
  const track = landing.track
  const end = track[track.length - 1]!.at
  const left = track.map((s) => apart(s.at, end))
  if (left[0]! < LANDED_WITHIN) return [{ name: "lands", ok: true, text: "nothing moves" }]
  if (left[0]! < TIMED_FROM) return [{ name: "lands", ok: true, text: `moves under ${TIMED_FROM}px, not timed` }]
  const frame = (track[track.length - 1]!.t - track[0]!.t) / (track.length - 1)
  const landed = left.findIndex((_, i) => left.slice(i).every((d) => d < LANDED_WITHIN))
  const took = track[landed]!.t - track[0]!.t + frame
  const ms = landing.duration * 1000
  const back = left.filter((d, i) => i > 0 && d > left[i - 1]! + BACK_TOLERANCE).length
  const onTime = Math.abs(took - ms) <= ON_TIME_FRAMES * frame
  const text = [`at ${took.toFixed(0)}ms (its ${ms.toFixed(0)}ms)`, back === 0 ? "never back" : `back on ${back} frames`].join(", ")
  return [line("lands", onTime && back === 0, text, `at ${ms.toFixed(0)}ms within ${(ON_TIME_FRAMES * frame).toFixed(0)}ms, never back`)]
}

/** The follows line (#8), when the run recorded where its Follower was drawn. */
const followsOf = (series: CrossfadeSeries | undefined): Array<CrossfadeCheck> => {
  const frames = series?.follows
  if (frames === undefined || frames.length === 0) return []
  const worst = Math.max(...frames)
  const off = frames.filter((d) => d >= 0.5).length
  return [line("follows", off === 0, off === 0 ? `within ${worst.toFixed(2)}px` : `off its Lead on ${off} frames, up to ${worst.toFixed(1)}px`, "the Follower on its Lead, within 0.5px")]
}

/** The aspect line (#169), when the run recorded its containers' badges. */
const aspectOf = (series: CrossfadeSeries | undefined): Array<CrossfadeCheck> => {
  const frames = series?.aspects
  const own = series?.ownAspects
  if (frames === undefined || own === undefined || frames.length === 0) return []
  let worst = 0
  let which = "neither"
  for (const f of frames) {
    for (const [side, ratio, base] of [["Lead's", f.lead, own.lead], ["Follower's", f.follower, own.follower]] as const) {
      if (ratio === null) continue
      const off = Math.abs(ratio / base - 1)
      if (off > worst) [worst, which] = [off, side]
    }
  }
  const pct = (worst * 100).toFixed(1)
  return [line("aspect", worst < 0.03, worst < 0.03 ? `within ${pct}%` : `the ${which} badge off its shape by ${pct}%`, "each badge within 3% of its own ratio")]
}

/** A crossfade run's lines (see the module doc). */
export const crossfadeChecksOf = (input: BoardRunInput): Array<CrossfadeCheck> => {
  const series = input.crossfade
  // A translucent twin is judged on its crossfade factor: its opacity over its own (#166).
  const own = series?.ownOpacity ?? { lead: 1, follower: 1 }
  const lead = input.during.map((l) => l / own.lead)
  const follower = (series?.follower ?? []).map((f) => (f === null ? null : f / own.follower))
  const leadEnd = lead[lead.length - 1]
  const followerEnd = lastOf(follower)
  const followerHidden = followerEnd === null || followerEnd === undefined || followerEnd <= 0.01
  const superseded = input.superseded === true
  const notJudged = (name: CrossfadeCheck["name"]): CrossfadeCheck => ({ name, ok: true, text: "superseded by the next run, not judged" })
  const starts = [...startsOf(series), ...landsOf(series, superseded)]
  if (series?.back === true) {
    return [
      ...starts,
      ...blendsOf(series, true),
      superseded ? notJudged("end") : line("end", leadEnd !== undefined && leadEnd >= 0.99, `Lead ${v3(leadEnd)}`, "Lead 1"),
    ]
  }
  if (series?.onlyMoves === true) {
    const lowest = Math.min(...lead)
    return [
      ...starts,
      ...followsOf(series),
      line("own fade", lowest >= 0.99, lowest >= 0.99 ? "none" : `down to ${v3(lowest)}`, "none: the Lead at 1 every frame"),
      superseded ? notJudged("end") : line("end", followerHidden, `Follower ${followerEnd === null ? "gone" : v3(followerEnd)}`, "the Follower hidden"),
    ]
  }
  const cover = lead.map((l, i) => {
    const f = follower[i]
    if (f === null || f === undefined) return l
    return 1 - (1 - l) * (1 - f)
  })
  const lowest = Math.min(...cover)
  const out = follower.findIndex((f) => f !== null && f !== undefined && f < 0.99)
  const leadAtOut = out === -1 ? undefined : lead[out]
  const ordered = leadAtOut === undefined || leadAtOut >= 0.99
  const between = lead.filter((l) => l > 0.01 && l < 0.99).length
  const ended = leadEnd !== undefined && leadEnd >= 0.99 && followerHidden
  const checks = [
    ...starts,
    ...followsOf(series),
    ...blendsOf(series, false),
    ...aspectOf(series),
    line("covers", lowest >= 0.98, `at least ${v3(lowest)}`, "0.98: never see-through"),
    line("order", ordered, out === -1 ? "the Follower never faded" : `Lead at ${v3(leadAtOut)} as the Follower fades`, "the Lead in first"),
    superseded ? notJudged("fades") : line("fades", between > 0, `${between} frames between`, "a fade, not a swap"),
    superseded
      ? notJudged("end")
      : line("end", ended, `Lead ${v3(leadEnd)}, Follower ${followerEnd === null ? "gone" : v3(followerEnd)}`, "Lead 1, Follower hidden"),
  ]
  const hits = series?.hitsFollower
  if (hits === undefined) return checks
  const hit = hits.filter(Boolean).length
  return [...checks, line("passes", hit === 0, hit === 0 ? "never hit the Follower" : `hit the Follower on ${hit} frames`, "the Lead's point never on the Follower")]
}
