import * as Bool from "effect/Boolean"

/**
 * Pure cyclic/stochastic value generators. Each returns a `(t) => number`
 * sampler so it composes with `createTransform`-style mapping in the bindings.
 */

const TAU = Math.PI * 2

/** The angular frequency of `period`, or 0 for a zero period (no motion rather than `Infinity`). */
const frequencyOf = (period: number): number => Bool.match(period === 0, { onTrue: () => 0, onFalse: () => TAU / period })

/**
 * Deterministic 1D value noise in [-1, 1], smooth between integer samples.
 * Same `seed` always yields the same curve.
 */
export const noise = (seed = 0): ((x: number) => number) => {
  const hash = (n: number): number => {
    const s = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
    return s - Math.floor(s)
  }
  return (x) => {
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f) // smoothstep
    const a = hash(i)
    const b = hash(i + 1)
    return (a + (b - a) * u) * 2 - 1
  }
}

/** Sine wave of given `amplitude` and `period` (seconds): `(t) => number`. */
export const wave = (amplitude: number, period: number): ((t: number) => number) => {
  const freq = frequencyOf(period)
  return (t) => amplitude * Math.sin(freq * t)
}

/**
 * Cyclic pulse in [0, 1] with the given `period` (seconds): 0 at the start of
 * each cycle, 1 at the midpoint. `(t) => number`.
 */
export const pulse = (period: number): ((t: number) => number) => {
  const freq = frequencyOf(period)
  return (t) => (1 - Math.cos(freq * t)) / 2
}
