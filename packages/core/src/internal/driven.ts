/**
 * The machine a driven machine measures as (#618, decision 10): `Playback.drive` keeps the machine it
 * drives, so `Machine.durationOf` steps that one, never the driven one, whose steps move its playhead.
 * Motion's `duration` is likewise the animation's own length.
 */
import * as UndefinedOr from "effect/UndefinedOr"

// Module state (#460, Q7): a cache keyed by what it caches, each driven machine's source, held weakly.
const SOURCES = new WeakMap<object, object>()

/** `driven`, measured from now on as `source`. */
export const measuredAs = <M extends object>(driven: M, source: M): M => {
  SOURCES.set(driven, source)
  return driven
}

/** The machine `machine` measures as: the one a drive drives, through every drive, else itself. */
export const sourceOf = <M extends object>(machine: M): M =>
  UndefinedOr.match(SOURCES.get(machine) as M | undefined, { onUndefined: () => machine, onDefined: sourceOf })
