/**
 * Easings: a tween's curve, from its progress in time to its progress along the way, each a function of
 * `t` from 0 to 1. Motion's named curves (`easeIn`, `easeOut`, `backOut`, `anticipate`…), which an
 * `ease` gives as a string; the Penner set (`easeOutCubic`…); `cubicBezier`, `steps`, and `spring`, a
 * spring as a curve. Any `(t) => number` is an easing too.
 *
 * @example
 * import * as Easing from "@wardic/core/Easing"
 *
 * const ease = Easing.resolve("easeOut") // or [0.25, 0.1, 0.35, 1], or Easing.easeOutCubic
 * ease(0.5) // ≈ 0.69: past halfway at half the time
 */
// #360, ADR-0052. Plain functions callers write as well as take (`(t) => t * t`), so no prototype
// (ADR-0028, decision 1); every easing runs per frame (ADR-0025).
import bezier from "bezier-easing"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"

/** An easing: a function from a tween's progress in time, 0 to 1, to its progress along the way. `(t) => t * t` is one. */
export type Easing = (t: number) => number

// The standard Penner easing set, normalized to `t` in [0, 1]. Every easing runs per frame (ADR-0025): a
// piecewise curve is a statement `if` per piece, with an early return, not a ternary or a match.

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5

/** No easing: progress as time goes, at an even pace. */
export const linear: Easing = (t) => t

/** Penner's quadratic curve, `t²`: a gentle one; it starts slow and speeds up. */
export const easeInQuad: Easing = (t) => t * t
/** Penner's quadratic curve, `t²`: a gentle one; it starts fast and slows to a stop. */
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t)
/** Penner's quadratic curve, `t²`: a gentle one; it slow at both ends and fast in the middle. */
export const easeInOutQuad: Easing = (t) => {
  if (t < 0.5) return 2 * t * t
  return 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** Penner's cubic curve, `t³`; it starts slow and speeds up. */
export const easeInCubic: Easing = (t) => t * t * t
/** Penner's cubic curve, `t³`; it starts fast and slows to a stop. */
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
/** Penner's cubic curve, `t³`; it slow at both ends and fast in the middle. */
export const easeInOutCubic: Easing = (t) => {
  if (t < 0.5) return 4 * t * t * t
  return 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Penner's quartic curve, `t⁴`: sharper; it starts slow and speeds up. */
export const easeInQuart: Easing = (t) => t * t * t * t
/** Penner's quartic curve, `t⁴`: sharper; it starts fast and slows to a stop. */
export const easeOutQuart: Easing = (t) => 1 - Math.pow(1 - t, 4)
/** Penner's quartic curve, `t⁴`: sharper; it slow at both ends and fast in the middle. */
export const easeInOutQuart: Easing = (t) => {
  if (t < 0.5) return 8 * t * t * t * t
  return 1 - Math.pow(-2 * t + 2, 4) / 2
}

/** Penner's quintic curve, `t⁵`: the sharpest of the powers; it starts slow and speeds up. */
export const easeInQuint: Easing = (t) => t * t * t * t * t
/** Penner's quintic curve, `t⁵`: the sharpest of the powers; it starts fast and slows to a stop. */
export const easeOutQuint: Easing = (t) => 1 - Math.pow(1 - t, 5)
/** Penner's quintic curve, `t⁵`: the sharpest of the powers; it slow at both ends and fast in the middle. */
export const easeInOutQuint: Easing = (t) => {
  if (t < 0.5) return 16 * t * t * t * t * t
  return 1 - Math.pow(-2 * t + 2, 5) / 2
}

/** Penner's sine curve: the softest; it starts slow and speeds up. */
export const easeInSine: Easing = (t) => 1 - Math.cos((t * Math.PI) / 2)
/** Penner's sine curve: the softest; it starts fast and slows to a stop. */
export const easeOutSine: Easing = (t) => Math.sin((t * Math.PI) / 2)
/** Penner's sine curve: the softest; it slow at both ends and fast in the middle. */
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2

/** Penner's exponential curve: very sharp; it starts slow and speeds up. */
export const easeInExpo: Easing = (t) => {
  if (t === 0) return 0
  return Math.pow(2, 10 * t - 10)
}
/** Penner's exponential curve: very sharp; it starts fast and slows to a stop. */
export const easeOutExpo: Easing = (t) => {
  if (t === 1) return 1
  return 1 - Math.pow(2, -10 * t)
}
/** Penner's exponential curve: very sharp; it slow at both ends and fast in the middle. */
export const easeInOutExpo: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2
  return (2 - Math.pow(2, -20 * t + 10)) / 2
}

/** Penner's circular curve, a quarter circle; it starts slow and speeds up. */
export const easeInCirc: Easing = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2))
/** Penner's circular curve, a quarter circle; it starts fast and slows to a stop. */
export const easeOutCirc: Easing = (t) => Math.sqrt(1 - Math.pow(t - 1, 2))
/** Penner's circular curve, a quarter circle; it slow at both ends and fast in the middle. */
export const easeInOutCirc: Easing = (t) => {
  if (t < 0.5) return (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
  return (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2
}

/** Penner's back curve: it draws back past its start, then goes. */
export const easeInBack: Easing = (t) => c3 * t * t * t - c1 * t * t
/** Penner's back curve: it goes past its end, then comes back to it. */
export const easeOutBack: Easing = (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
/** Penner's back curve: past its start, then past its end, then back. */
export const easeInOutBack: Easing = (t) => {
  if (t < 0.5) return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
  return (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
}

/** Penner's elastic curve: it winds up, springing back and forth, then goes. */
export const easeInElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
}
/** Penner's elastic curve: it springs past its end and back several times before it rests. */
export const easeOutElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
/** Penner's elastic curve at both ends. */
export const easeInOutElastic: Easing = (t) => {
  if (t === 0) return 0
  if (t === 1) return 1
  if (t < 0.5) return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
}

/** Penner's bounce curve: it lands and bounces to rest at its end, like a dropped ball. */
export const easeOutBounce: Easing = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
/** Penner's bounce curve, reversed: it bounces at its start, then goes. */
export const easeInBounce: Easing = (t) => 1 - easeOutBounce(1 - t)
/** Penner's bounce curve at both ends. */
export const easeInOutBounce: Easing = (t) => {
  if (t < 0.5) return (1 - easeOutBounce(1 - 2 * t)) / 2
  return (1 + easeOutBounce(2 * t - 1)) / 2
}

/**
 * A cubic Bézier easing through the control points `(x1, y1)` and `(x2, y2)`, as CSS's
 * `cubic-bezier()`. An `ease` of `[x1, y1, x2, y2]` is the same.
 *
 * @example
 * const standard = Easing.cubicBezier(0.4, 0, 0.2, 1)
 */
// Backed by `bezier-easing`.
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number): Easing =>
  named(bezier(x1, y1, x2, y2), `cubicBezier(${x1},${y1},${x2},${y2})`)

/** Where each of `steps`' jumps happens: at the `"start"` of its interval, or its `"end"`. */
export type StepPosition = "start" | "end"

/**
 * An easing in `count` jumps, as CSS's `steps()`: each at the end of its interval (the default), or its
 * start. For a value that should tick, not glide.
 *
 * @example
 * const tick = Easing.steps(12) // a clock hand's twelve jumps
 */
export const steps = (count: number, position: StepPosition = "end"): Easing => {
  const n = Math.max(1, Math.floor(count))
  // Chosen once, so the easing itself, which runs per frame, only rounds (ADR-0025).
  const round = Bool.match(position === "start", { onTrue: () => Math.ceil, onFalse: () => Math.floor })
  return named((t) => {
    const clamped = Scalar.clamp(t, 0, 1)
    const step = round(clamped * n)
    return Scalar.clamp(step / n, 0, 1)
  }, `steps(${n},${position})`)
}

/**
 * A spring curve's options: its physics, `stiffness`, `damping` and `mass`, or its time, `duration`,
 * `bounce` and `visualDuration`. They're a spring's options, so its other fields may come too: they're
 * checked, but don't shape the curve.
 */
// #359 for time; `Spring.resolve` decodes the bag (#225).
export interface SpringOptions {
  /** How stiff it is: higher is snappier. Default 170. */
  readonly stiffness?: number
  /** How damped it is: higher settles sooner, with less overshoot. Default 26. */
  readonly damping?: number
  /** The mass it moves: heavier is slower. Default 1. */
  readonly mass?: number
  /** A spring set by time: its curve runs to `duration` seconds, ending on 1. */
  readonly duration?: number
  /** How much a spring set by time bounces: 0 none, toward 1 a lot. */
  readonly bounce?: number
  /** A spring set by time that has done most of its move by `visualDuration` seconds: its curve runs to rest. */
  readonly visualDuration?: number
}

/** No options: the spring's defaults, one bag, so its decode is cached (#66). */
const NO_SPRING: SpringOptions = {}

/** The unit spring `spring` samples, between two of its 1/240 s steps. */
interface SpringSim {
  readonly position: number
  readonly velocity: number
  readonly elapsed: number
  readonly rested: boolean
}

/**
 * A spring as an easing: the spring's run from 0 to 1, until it rests, as a curve, so a tween of any
 * duration moves as that spring would, its overshoot included. For whatever takes an easing; a value
 * that should keep its velocity when its target changes runs on `Machine.spring` instead. A `duration`
 * spring's curve ends at its duration, landing on 1. A value no spring can take, a stiffness at or below
 * 0 say, throws an `OptionError` naming the field.
 *
 * @example
 * const ease = Easing.spring({ visualDuration: 0.5, bounce: 0.3 })
 */
// Unlike `Machine.spring` (ADR-0001: a live primitive settling to a static target; `chase` follows a
// moving one), a one-shot curve: run 0 → 1 to rest, sampled every 1/240 s on its exact solution
// (Motion's closed form, #370), re-normalized. Its bag is checked as every spring bag is (#225, ADR-0025
// *Amendment (#225)*); a time-based spring (#359). It bakes its own rest thresholds and step.
export const spring = (options: SpringOptions = NO_SPRING): Easing => {
  const resolved = Spring.resolve(options)
  const { stiffness, damping, mass, duration } = resolved
  const restDelta = 1e-4
  const restSpeed = 1e-4
  // A time-based spring's curve is its run to its duration (#359), on steps of about 1/240 s that end
  // on it; every other's runs to rest, on 1/240 s steps, within 10 s.
  const timed = duration !== Infinity
  const dt = Bool.match(timed, { onTrue: () => duration / Math.max(1, Math.round(duration * 240)), onFalse: () => 1 / 240 })
  // Half a step short, so a sum of steps a hair under the end doesn't take one more.
  const lastStart = Math.min(duration, 10) - dt / 2
  // The spring's exact step over `dt` (#370), copied out: its matrix is the spring's, and a run on
  // the same options could step it with another `dt`.
  const { dd, dv, vd, vv } = Spring.matrixFor(resolved, dt)

  /** One step of the unit spring, or `None` once it has come to rest (one that ends at rest) or run out of time. */
  const advance = (sim: SpringSim): Option.Option<readonly [number, SpringSim]> =>
    Option.liftPredicate(sim, (s) => Bool.and(Bool.or(timed, !s.rested), s.elapsed < lastStart)).pipe(
      Option.map((s) => {
        const d = s.position - 1
        const position = 1 + dd * d + dv * s.velocity
        const velocity = vd * d + vv * s.velocity
        const rested = Bool.and(Math.abs(velocity) < restSpeed, Math.abs(position - 1) < restDelta)
        return [position, { position, velocity, elapsed: s.elapsed + dt, rested }] as const
      }),
    )
  const simulated = Arr.prepend(Arr.unfold({ position: 0, velocity: 0, elapsed: 0, rested: false }, advance), 0)
  // A time-based spring lands on 1 at its duration, its last sample, as its machine does.
  const samples = Bool.match(timed, { onTrue: () => Arr.append(Arr.dropRight(simulated, 1), 1), onFalse: () => simulated })

  const lastIndex = samples.length - 1
  // Per frame (ADR-0025): early returns, and indexes in range by construction.
  return named((t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const idx = t * lastIndex
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, lastIndex)
    const frac = idx - lo
    const from = samples[lo]
    return from + (samples[hi] - from) * frac
  }, Bool.match(timed, { onTrue: () => `spring(${stiffness},${damping},${mass},${duration})`, onFalse: () => `spring(${stiffness},${damping},${mass})` }))
}

// --- Names (#48, ADR-0044) --------------------------------------------------------------------

/**
 * The name each easing Wardic makes was made with. A server names a mount animation's transition
 * by it (an Appear animation's spec), so the same easing names the same CSS rule on the server and
 * the client, where each made its own function.
 */
const NAMES = new WeakMap<Easing, string>()

/** `easing`, remembered under `name`. */
function named(easing: Easing, name: string): Easing {
  NAMES.set(easing, name)
  return easing
}

Arr.forEach(
  Object.entries({
    linear, easeInQuad, easeOutQuad, easeInOutQuad, easeInCubic, easeOutCubic, easeInOutCubic,
    easeInQuart, easeOutQuart, easeInOutQuart, easeInQuint, easeOutQuint, easeInOutQuint,
    easeInSine, easeOutSine, easeInOutSine, easeInExpo, easeOutExpo, easeInOutExpo,
    easeInCirc, easeOutCirc, easeInOutCirc, easeInBack, easeOutBack, easeInOutBack,
    easeInElastic, easeOutElastic, easeInOutElastic, easeOutBounce, easeInBounce, easeInOutBounce,
  }),
  ([name, easing]) => named(easing, name),
)

/**
 * The name an easing Wardic made was made with: a curve's own (`"easeOutCubic"`), or a factory's call
 * with its arguments (`"cubicBezier(0.4,0,0.2,1)"`, `"steps(4,end)"`). `None` for a function you wrote,
 * which can't be told from another. A server names a mount animation's CSS easing by it, so the server
 * and the client agree.
 */
// #48, ADR-0044: an Appear animation's spec.
export const nameOf = (easing: Easing): Option.Option<string> => Option.fromUndefinedOr(NAMES.get(easing))

// --- Motion's easings (#360, ADR-0052) --------------------------------------------------------

/** An easing played backwards, which turns an ease-in into an ease-out: Motion's `reverseEasing`. */
// A sequence's `repeatType: "reverse"` plays every other pass of a Segment on it (#433). Per frame.
export const reverse = (easing: Easing): Easing => (t) => 1 - easing(1 - t)

/**
 * `easing` over the first half and mirrored over the second: Motion's `mirrorEasing`, which turns
 * an ease-in into an ease-in-out. Per frame.
 */
const mirrored = (easing: Easing): Easing => (t) => {
  if (t <= 0.5) return easing(2 * t) / 2
  return (2 - easing(2 * (1 - t))) / 2
}

/** Motion's `easeIn`: `cubic-bezier(0.42, 0, 1, 1)`, CSS's `ease-in`. */
export const easeIn: Easing = named(bezier(0.42, 0, 1, 1), "easeIn")

/** Motion's `easeOut`: `cubic-bezier(0, 0, 0.58, 1)`, CSS's `ease-out`. A tween's default. */
// ADR-0051.
export const easeOut: Easing = named(bezier(0, 0, 0.58, 1), "easeOut")

/** Motion's `easeInOut`: `cubic-bezier(0.42, 0, 0.58, 1)`, CSS's `ease-in-out`. */
export const easeInOut: Easing = named(bezier(0.42, 0, 0.58, 1), "easeInOut")

/** Motion's `circIn`: a quarter circle, slow then steep (the Penner `easeInCirc`'s curve). */
export const circIn: Easing = named((t) => 1 - Math.sin(Math.acos(t)), "circIn")

/** Motion's `circOut`: {@link circIn} reversed. */
export const circOut: Easing = named(reverse(circIn), "circOut")

/** Motion's `circInOut`: {@link circIn} mirrored. */
export const circInOut: Easing = named(mirrored(circIn), "circInOut")

/** Motion's `backOut`: `cubic-bezier(0.33, 1.53, 0.69, 0.99)`, past its end and back. Not the Penner `easeOutBack`. */
export const backOut: Easing = named(bezier(0.33, 1.53, 0.69, 0.99), "backOut")

/** Motion's `backIn`: {@link backOut} reversed, back before it goes. */
export const backIn: Easing = named(reverse(backOut), "backIn")

/** Motion's `backInOut`: {@link backIn} mirrored. */
export const backInOut: Easing = named(mirrored(backIn), "backInOut")

/** Motion's `anticipate`: {@link backIn} over the first half, then an exponential ease out. Per frame. */
export const anticipate: Easing = named((t) => {
  if (t >= 1) return 1
  const p = t * 2
  if (p < 1) return 0.5 * backIn(p)
  return 0.5 * (2 - Math.pow(2, -10 * (p - 1)))
}, "anticipate")

/** Motion's names for its easings: what an `ease` string can be. */
// `motion-utils`' `easingLookup`, at 16c6122.
export type Name = "linear" | "easeIn" | "easeOut" | "easeInOut" | "circIn" | "circOut" | "circInOut" | "backIn" | "backOut" | "backInOut" | "anticipate"

/** Each of Motion's names, and its curve. */
const BY_NAME: Readonly<Record<Name, Easing>> = { linear, easeIn, easeOut, easeInOut, circIn, circOut, circInOut, backIn, backOut, backInOut, anticipate }

/** Motion's names, for a decode to check an `ease` string against. */
export const NAMES_LIST: ReadonlyArray<Name> = Object.keys(BY_NAME) as ReadonlyArray<Name>

/** A cubic bézier's control points, `[x1, y1, x2, y2]`: Motion's `BezierDefinition`. */
export type Bezier = readonly [number, number, number, number]

/**
 * An easing as an `ease` takes it, as Motion's: one of Motion's names, a cubic Bézier's four numbers,
 * or a function.
 */
// CONTEXT.md **Easing definition**, #360.
export type Definition = Name | Bezier | Easing

/** Whether `definition` is a bézier's points: an array whose first item is a number (Motion's `isBezierDefinition`). */
export const isBezier = (definition: unknown): definition is Bezier =>
  Bool.and(Array.isArray(definition), Predicate.isNumber((definition as ReadonlyArray<unknown>)[0]))

/** {@link resolve}'s matcher, built once, at module load. */
const resolveDefinition: (definition: Definition) => Easing = Match.type<Definition>().pipe(
  Match.when(Predicate.isFunction, (easing) => easing as Easing),
  Match.when(isBezier, ([x1, y1, x2, y2]) => cubicBezier(x1, y1, x2, y2)),
  Match.orElse((name) => BY_NAME[name as Name]),
)

/**
 * The easing a definition gives: a name's curve, a Bézier through its points, or the function itself.
 * Resolve once, where an animation is built, not each frame.
 *
 * @example
 * const ease = Easing.resolve(options.ease ?? "easeOut")
 */
// #360: a Bézier through `cubicBezier`, named, so Appear keys it; an option bag's decode resolves its
// `ease` once (#66).
export const resolve = (definition: Definition): Easing => resolveDefinition(definition)

