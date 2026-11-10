/**
 * What a Playhead's drivers share (#433, #665): the Playhead as they write it, and a tick at its speed.
 * `Playback`'s operations and driven machines use them, and so does a Batch's driven change.
 */
import type * as Playback from "../Playback.ts"

/** A Playhead as its operations and its drivers write it. */
export interface Writable {
  time: number
  speed: number
  paused: boolean
}

/** `head`, to write. */
export const writableOf = (head: Playback.Playhead): Writable => head as unknown as Writable

/** A tick of `dt` at `head`'s speed, at most `most` either way. */
// Per frame, per driver (ADR-0025): `Math.min` / `Math.max`.
export const tickOf = (head: Playback.Playhead, dt: number, most: number): number => Math.max(-most, Math.min(most, dt * head.speed))
