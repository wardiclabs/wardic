/**
 * Values that change over time on their own: `sine` and `pulse` repeat, and `noise` wanders. Each is a
 * function of time in seconds, or of any number, for something that bobs, breathes or drifts.
 *
 * @example
 * import * as Wave from "@wardic/core/Wave"
 *
 * const bob = Wave.sine(8, 2) // 8 px up and down, every 2 s
 * const y = bob(seconds)
 */
import * as Bool from "effect/Boolean"

const TAU = Math.PI * 2

/** The angular frequency of `period`, or 0 for a zero period (no motion rather than `Infinity`). */
const frequencyOf = (period: number): number => Bool.match(period === 0, { onTrue: () => 0, onFalse: () => TAU / period })

/**
 * Smooth random noise from -1 to 1: a function that wanders between a random value at each whole
 * number. The same `seed` gives the same curve, so a scene drifts the same way each time it plays.
 *
 * @example
 * const drift = Wave.noise(3)
 * const x = drift(seconds * 0.5) * 20 // within 20 px either side, changing every 2 s
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

/**
 * A sine wave: a function of time, in seconds, from `-amplitude` to `amplitude` and back every
 * `period` seconds. A period of 0 stays at 0.
 */
export const sine = (amplitude: number, period: number): ((t: number) => number) => {
  const freq = frequencyOf(period)
  return (t) => amplitude * Math.sin(freq * t)
}

/**
 * A pulse from 0 to 1 and back every `period` seconds: 0 as each cycle starts, 1 halfway. A period of 0
 * stays at 0.
 *
 * @example
 * const glow = Wave.pulse(1.5)
 * const opacity = 0.4 + glow(seconds) * 0.6
 */
export const pulse = (period: number): ((t: number) => number) => {
  const freq = frequencyOf(period)
  return (t) => (1 - Math.cos(freq * t)) / 2
}
