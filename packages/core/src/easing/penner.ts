import type { Easing } from "../options.ts"

/**
 * The standard Penner easing set, normalized to `t` in [0, 1].
 * `easeOutX` is the most useful family for UI; `easeInOutX` for symmetric motion.
 */

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5

export const linear: Easing = (t) => t

export const easeInQuad: Easing = (t) => t * t
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t)
export const easeInOutQuad: Easing = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export const easeInCubic: Easing = (t) => t * t * t
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export const easeInQuart: Easing = (t) => t * t * t * t
export const easeOutQuart: Easing = (t) => 1 - Math.pow(1 - t, 4)
export const easeInOutQuart: Easing = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2)

export const easeInQuint: Easing = (t) => t * t * t * t * t
export const easeOutQuint: Easing = (t) => 1 - Math.pow(1 - t, 5)
export const easeInOutQuint: Easing = (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2)

export const easeInSine: Easing = (t) => 1 - Math.cos((t * Math.PI) / 2)
export const easeOutSine: Easing = (t) => Math.sin((t * Math.PI) / 2)
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2

export const easeInExpo: Easing = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10))
export const easeOutExpo: Easing = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const easeInOutExpo: Easing = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2

export const easeInCirc: Easing = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2))
export const easeOutCirc: Easing = (t) => Math.sqrt(1 - Math.pow(t - 1, 2))
export const easeInOutCirc: Easing = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2

export const easeInBack: Easing = (t) => c3 * t * t * t - c1 * t * t
export const easeOutBack: Easing = (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
export const easeInOutBack: Easing = (t) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2

export const easeInElastic: Easing = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
export const easeOutElastic: Easing = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
export const easeInOutElastic: Easing = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1

export const easeOutBounce: Easing = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
export const easeInBounce: Easing = (t) => 1 - easeOutBounce(1 - t)
export const easeInOutBounce: Easing = (t) =>
  t < 0.5 ? (1 - easeOutBounce(1 - 2 * t)) / 2 : (1 + easeOutBounce(2 * t - 1)) / 2
