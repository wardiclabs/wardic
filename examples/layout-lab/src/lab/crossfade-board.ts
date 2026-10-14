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
 *
 * A handover that only moves, inside a crossfading container (#5), is judged on **own fade**
 * instead: its Lead at 1 on every frame, and its **end**, its Follower hidden once it's over.
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
}

/** A crossfade card's lines, in display order. */
export const CROSSFADE_CHECK_NAMES = ["covers", "order", "fades", "own fade", "end", "passes"] as const

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

/** A crossfade run's lines (see the module doc). */
export const crossfadeChecksOf = (input: BoardRunInput): Array<CrossfadeCheck> => {
  const lead = input.during
  const series = input.crossfade
  const follower = series?.follower ?? []
  const leadEnd = lead[lead.length - 1]
  const followerEnd = lastOf(follower)
  const followerHidden = followerEnd === null || followerEnd === undefined || followerEnd <= 0.01
  if (series?.onlyMoves === true) {
    const lowest = Math.min(...lead)
    return [
      line("own fade", lowest >= 0.99, lowest >= 0.99 ? "none" : `down to ${v3(lowest)}`, "none: the Lead at 1 every frame"),
      line("end", followerHidden, `Follower ${followerEnd === null ? "gone" : v3(followerEnd)}`, "the Follower hidden"),
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
    line("covers", lowest >= 0.98, `at least ${v3(lowest)}`, "0.98: never see-through"),
    line("order", ordered, out === -1 ? "the Follower never faded" : `Lead at ${v3(leadAtOut)} as the Follower fades`, "the Lead in first"),
    line("fades", between > 0, `${between} frames between`, "a fade, not a swap"),
    line("end", ended, `Lead ${v3(leadEnd)}, Follower ${followerEnd === null ? "gone" : v3(followerEnd)}`, "Lead 1, Follower hidden"),
  ]
  const hits = series?.hitsFollower
  if (hits === undefined) return checks
  const hit = hits.filter(Boolean).length
  return [...checks, line("passes", hit === 0, hit === 0 ? "never hit the Follower" : `hit the Follower on ${hit} frames`, "the Lead's point never on the Follower")]
}
