import type { Easing } from "../options.ts"

/**
 * The standard Penner easing set, normalized to `t` in [0, 1].
 * `easeOutX` is the most useful family for UI; `easeInOutX` for symmetric motion.
 *
 * Every easing runs per frame (ADR-0025): a piecewise curve is a statement `if` per piece,
 * with an early return, not a ternary or a match.
 */

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5

export const linear: Easing = (t) => t

export const easeInQuad: Easing = (t) => t * t
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t)
export const easeInOutQuad: Easing = (t) => {
  if (t < 0.5) return 2 * t * t
  return 1 - Math.pow(-2 * t + 2, 2) / 2
}

export const easeInCubic: Easing = (t) => t * t * t
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic: Easing = (t) => {
  if (t < 0.5) return 4 * t * t * t
  return 1 - Math.pow(-2 * t + 2, 3) / 2
}

export const easeInQuart: Easing = (t) => t * t * t * t
export const easeOutQuart: Easing = (t) => 1 - Math.pow(1 - t, 4)
export const easeInOutQuart: Easing = (t) => {
  if (t < 0.5) return 8 * t * t * t * t
  return 1 - Math.pow(-2 * t + 2, 4) / 2
}

export const easeInQuint: Easing = (t) => t * t * t * t * t
export const easeOutQuint: Easing = (t) => 1 - Math.pow(1 - t, 5)
export const easeInOutQuint: Easing = (t) => {
  if (t < 0.5) return 16 * t * t * t * t * t
  return 1 - Math.pow(-2 * t + 2, 5) / 2
}

export const easeInSine: Easing = (t) => 1 - Math.cos((t * Math.PI) / 2)
export const easeOutSine: Easing = (t) => Math.sin((t * Math.PI) / 2)
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2

export const easeInExpo: Easing = (t) => {
  if (t === 0) return 0
  return Math.pow(2, 10 * t - 10)
}
export const easeOutExpo: Easing = (t) => {
  if (t === 1) return 1
  return 1 - Math.pow(2, -10 * t)
}
export const easeInOutExpo: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2
  return (2 - Math.pow(2, -20 * t + 10)) / 2
}

export const easeInCirc: Easing = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2))
export const easeOutCirc: Easing = (t) => Math.sqrt(1 - Math.pow(t - 1, 2))
export const easeInOutCirc: Easing = (t) => {
  if (t < 0.5) return (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
  return (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2
}

export const easeInBack: Easing = (t) => c3 * t * t * t - c1 * t * t
export const easeOutBack: Easing = (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
export const easeInOutBack: Easing = (t) => {
  if (t < 0.5) return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
  return (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
}

export const easeInElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
}
export const easeOutElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
export const easeInOutElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  if (t < 0.5) return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
}

export const easeOutBounce: Easing = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
export const easeInBounce: Easing = (t) => 1 - easeOutBounce(1 - t)
export const easeInOutBounce: Easing = (t) => {
  if (t < 0.5) return (1 - easeOutBounce(1 - 2 * t)) / 2
  return (1 + easeOutBounce(2 * t - 1)) / 2
}
