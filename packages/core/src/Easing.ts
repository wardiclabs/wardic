/**
 * The `Easing` module: an easing maps normalized time `t` in [0, 1] to eased progress. The
 * Penner set (names kept), `cubicBezier`, `steps`, and `spring`, a spring baked into a curve; and
 * Motion's named easings (`easeIn`, `easeOut`, `backIn`, `anticipate`…), which an `ease` names as
 * a string, beside a bézier's four numbers or a function: a {@link Definition} (#360, ADR-0052).
 * Plain functions callers write as well as take (`(t) => t * t`), so no prototype (ADR-0028,
 * decision 1); every easing runs per frame (ADR-0025).
 */
import bezier from "bezier-easing"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"

/** Easing function mapping normalized time `t` in [0, 1] to eased progress. */
export type Easing = (t: number) => number

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

/**
 * A CSS-style cubic-bezier easing through control points (x1, y1, x2, y2).
 * Backed by `bezier-easing`.
 */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number): Easing =>
  named(bezier(x1, y1, x2, y2), `cubicBezier(${x1},${y1},${x2},${y2})`)

/** Step position — where the jump happens within each step. */
export type StepPosition = "start" | "end"

/**
 * A stepped easing (CSS `steps()`). `count` discrete steps; `position` controls
 * whether the value jumps at the start or end of each interval.
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
 * Options shaping a {@link spring} curve: its `stiffness`, `damping` and `mass`, or its time (#359,
 * `Machine.SpringOptions`'s `duration`, `bounce` and `visualDuration`). The bag is a spring's
 * (`Spring.resolve` decodes it, #225), so a spring's other fields may come with it, and are checked,
 * but don't shape the curve.
 */
export interface SpringOptions {
  readonly stiffness?: number
  readonly damping?: number
  readonly mass?: number
  /** A time-based spring's duration, in seconds (#359): its curve runs to it, ending on 1. */
  readonly duration?: number
  /** A time-based spring's bounce (#359). */
  readonly bounce?: number
  /** A time-based spring's visual duration, in seconds (#359): its curve runs to rest. */
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
 * Bakes spring physics into a fixed-duration easing curve normalized to [0, 1].
 *
 * Unlike the live `Machine.spring` primitive (which settles to a static target;
 * interruption is the binding's responsibility, and moving-target follow lives
 * in `chase` — see ADR-0001), this is a one-shot easing for cases that need a
 * `(t) => progress` function — the spring is run 0 → 1 to rest, sampled every
 * 1/240 s on its exact solution (Motion's closed form, #370), then re-normalized.
 *
 * Its bag is checked as every spring bag is (`Spring.resolve`, #225, ADR-0025 *Amendment (#225)*), when
 * it's called: a value no spring can take (a stiffness or mass at or below 0, a negative damping, NaN,
 * Infinity) throws its `OptionError` (`Machine.OptionError`), naming the field. Only `stiffness`, `damping` and `mass` shape
 * the curve, or a time-based spring's `duration`, `bounce` and `visualDuration` (#359): a `duration`
 * spring's curve is its run to that duration, landing on 1 there, as its machine does. It bakes its
 * own rest thresholds and step.
 */
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
 * The name an easing was made with (#48, ADR-0044): a Penner easing's own (`"easeOutCubic"`), or a
 * factory's call with its arguments (`"cubicBezier(0.4,0,0.2,1)"`, `"steps(4,end)"`,
 * `"spring(170,26,1)"`). `None` for a function an app wrote itself, which a server can't tell from
 * another.
 */
export const nameOf = (easing: Easing): Option.Option<string> => Option.fromUndefinedOr(NAMES.get(easing))

// --- Motion's easings (#360, ADR-0052) --------------------------------------------------------

/**
 * `easing` played backwards: Motion's `reverseEasing`, which turns an ease-in into an ease-out. A
 * sequence's `repeatType: "reverse"` plays every other pass of a Segment on it (#433). Per frame.
 */
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

/** Motion's names for its easings (`motion-utils`' `easingLookup`, at 16c6122): what an `ease` string can be. */
export type Name = "linear" | "easeIn" | "easeOut" | "easeInOut" | "circIn" | "circOut" | "circInOut" | "backIn" | "backOut" | "backInOut" | "anticipate"

/** Each of Motion's names, and its curve. */
const BY_NAME: Readonly<Record<Name, Easing>> = { linear, easeIn, easeOut, easeInOut, circIn, circOut, circInOut, backIn, backOut, backInOut, anticipate }

/** Motion's names, for a decode to check an `ease` string against. */
export const NAMES_LIST: ReadonlyArray<Name> = Object.keys(BY_NAME) as ReadonlyArray<Name>

/** A cubic bézier's control points, `[x1, y1, x2, y2]`: Motion's `BezierDefinition`. */
export type Bezier = readonly [number, number, number, number]

/**
 * An Easing as an `ease` gives it (CONTEXT.md **Easing definition**, #360), as Motion's `Easing`:
 * one of Motion's names, a cubic bézier's four numbers, or the function itself.
 */
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
 * The Easing `definition` names (#360): a name's curve, a bézier through its points
 * ({@link cubicBezier}, named, so Appear keys it), or the function as it is. Not per frame: an
 * option bag's decode resolves its `ease` once (#66).
 */
export const resolve = (definition: Definition): Easing => resolveDefinition(definition)

