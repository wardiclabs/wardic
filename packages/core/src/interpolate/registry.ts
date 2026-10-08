import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { lerp } from "../math/index.ts"
import { InterpolatorRegistry } from "../services/InterpolatorRegistry.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { arrayInterpolator } from "./array.ts"
import { colorInterpolator } from "./color.ts"
import { complexInterpolator } from "./complex.ts"
import { discrete } from "./discrete.ts"
import { numberInterpolator } from "./number.ts"
import { incompatible, parseUnit, unitOfPair } from "./parse-unit.ts"
import { unitInterpolator } from "./unit.ts"

// The registry is heterogeneous by design: its entries are `InterpolatorEntry<any>`.

/**
 * The interpolators core ships with, in resolution order. `number` and `array`
 * are checked first (cheap, unambiguous); `color` before `unit` so `"#fff"`
 * routes to color while `"10px"` routes to unit; `complex` LAST so it only
 * catches multi-number structural strings (SVG `d`/`points`, `filter`,
 * `box-shadow`) the specific entries didn't claim (ADR-0015).
 */
export const defaultInterpolators: ReadonlyArray<InterpolatorEntry<any>> = [
  numberInterpolator,
  arrayInterpolator,
  colorInterpolator("rgb"),
  unitInterpolator,
  complexInterpolator,
]

/** A blend from `from` to `to` at progress `t`: what `resolve` returns. */
type Blend<From, To> = (t: number) => From | To

/** A Discrete pair's blend: `from`, then `to` from the first frame past 0 (ADR-0024, decision 3). */
const discreteBlend =
  <From, To>(from: From, to: To): Blend<From, To> =>
  (t) =>
    discrete(from, to, t)

/** A number or an array: an endpoint with no type information of its own. */
const isPlain: Predicate.Predicate<unknown> = Predicate.or(Predicate.isNumber, Arr.isArray)

/** An entry that matches `value`. */
const matching =
  (value: unknown): Predicate.Predicate<InterpolatorEntry<any>> =>
  (entry) =>
    entry.match(value)

/** An entry that matches both endpoints. */
const matchingBoth = (from: unknown, to: unknown): Predicate.Predicate<InterpolatorEntry<any>> =>
  Predicate.and(matching(from), matching(to))

type Pair = readonly [from: unknown, to: unknown]

/** A pair whose first endpoint carries the type: it isn't plain, and the other is. */
const typedFirst: Predicate.Predicate<Pair> = Predicate.Tuple([Predicate.not(isPlain), isPlain])
/** A pair whose second endpoint carries the type. */
const typedSecond: Predicate.Predicate<Pair> = Predicate.Tuple([isPlain, Predicate.not(isPlain)])

/** The endpoint that carries the pair's type: the one that isn't plain, when the other is. */
const typedEnd = (pair: Pair): Option.Option<unknown> =>
  Option.map(Option.liftPredicate(pair, typedFirst), ([from]) => from).pipe(
    Option.orElse(() => Option.map(Option.liftPredicate(pair, typedSecond), ([, to]) => to)),
  )

/**
 * Pair-aware entry selection.
 *
 * An entry "matches a pair" iff it matches at least one endpoint. When
 * multiple entries match, the most type-bearing one wins — concretely, the
 * entry that matches a string endpoint beats one that only matches a numeric
 * endpoint (so `(0, "10px")` resolves to the unit interpolator, not number).
 *
 * `None` when no entry matches either endpoint, signalling the discrete-fallback
 * path: a Discrete pair, which switches to `to` at the first frame past 0
 * (ADR-0024 decision 3; Motion's `mixImmediate`).
 */
const selectEntry = (
  entries: ReadonlyArray<InterpolatorEntry<any>>,
  from: unknown,
  to: unknown,
): Option.Option<InterpolatorEntry<any>> =>
  // Pass 1: entry that matches both endpoints — strongest signal.
  Arr.findFirst(entries, matchingBoth(from, to)).pipe(
    // Pass 2: entry that matches the non-number/non-array endpoint — that side
    // carries the type information, so it wins over a number/array matcher on
    // the other endpoint.
    Option.orElse(() => Option.flatMap(typedEnd([from, to]), (typed) => Arr.findFirst(entries, matching(typed)))),
    // Pass 3: any entry that matches either endpoint, in registry precedence.
    Option.orElse(() => Arr.findFirst(entries, Predicate.or(matching(from), matching(to)))),
  )

/** Two unit strings: incompatible units die; an unparseable one (`"auto"`) is a Discrete pair. */
const bindUnitStrings = (from: string, to: string): Effect.Effect<Blend<string, string>> =>
  Option.match(Option.all([parseUnit(from), parseUnit(to)]), {
    onNone: () => Effect.succeed(discreteBlend(from, to)),
    onSome: (units) =>
      Bool.match(incompatible(units), {
        onTrue: () =>
          Effect.die(
            new Error(
              `wardic.interpolator: incompatible units "${units[0].unit}" and "${units[1].unit}" (from "${from}", to "${to}")`,
            ),
          ),
        onFalse: () => {
          const [a, b] = units
          const unit = unitOfPair(a, b)
          return Effect.succeed((t: number) => `${lerp(a.value, b.value, t)}${unit}`)
        },
      }),
  })

/** A bare number and a unit string: the number takes the string's unit. */
const bindNumberToUnit = (from: number, to: string): Effect.Effect<Blend<number, string>> =>
  Option.match(parseUnit(to), {
    onNone: () => Effect.succeed(discreteBlend(from, to)),
    onSome: (b) => Effect.succeed((t: number) => `${lerp(from, b.value, t)}${b.unit}`),
  })

/** A unit string and a bare number: the number takes the string's unit. */
const bindUnitToNumber = (from: string, to: number): Effect.Effect<Blend<string, number>> =>
  Option.match(parseUnit(from), {
    onNone: () => Effect.succeed(discreteBlend(from, to)),
    onSome: (a) => Effect.succeed((t: number) => `${lerp(a.value, to, t)}${a.unit}`),
  })

const bothStrings = Predicate.Tuple([Predicate.isString, Predicate.isString])
const numberThenString = Predicate.Tuple([Predicate.isNumber, Predicate.isString])
const stringThenNumber = Predicate.Tuple([Predicate.isString, Predicate.isNumber])

/**
 * The unit interpolator's pairs, which it binds itself to enforce compatible units and coerce
 * bare numbers. `None` for any other pair, which takes the default binding.
 */
const bindUnit = (pair: Pair): Option.Option<Effect.Effect<Blend<unknown, unknown>>> =>
  Match.value(pair).pipe(
    Match.when(bothStrings, ([from, to]) => bindUnitStrings(from, to)),
    Match.when(numberThenString, ([from, to]) => bindNumberToUnit(from, to)),
    Match.when(stringThenNumber, ([from, to]) => bindUnitToNumber(from, to)),
    Match.option,
  )

/** The unit interpolator. */
const isUnitEntry: Predicate.Predicate<InterpolatorEntry<any>> = (entry) => entry.name === "unit"

/**
 * Resolves a pair to a pure `(t) => From | To` for the given entry. Handles
 * the mixed numeric `from` + unit-string `to` (and the symmetric) case by
 * coercing the bare number to the same unit as the string. Incompatible
 * unit pairs (e.g. `"10px"` + `"1em"`) produce an `Effect.die` with both
 * units in the message.
 */
const bind = <From, To>(entry: InterpolatorEntry<any>, from: From, to: To): Effect.Effect<Blend<From, To>> =>
  Option.liftPredicate(entry, isUnitEntry).pipe(
    Option.flatMap(() => bindUnit([from, to])),
    Option.map((unit) => unit as Effect.Effect<Blend<From, To>>),
    // Default: if the entry doesn't match both endpoints, fall back to discrete
    // (the entry's `interpolate` is only contracted for matching inputs).
    Option.getOrElse(() =>
      Bool.match(matchingBoth(from, to)(entry), {
        onTrue: () => Effect.succeed((t: number): From | To => entry.interpolate(from, to, t)),
        onFalse: () => Effect.succeed(discreteBlend(from, to)),
      }),
    ),
  )

/**
 * Builds the `InterpolatorRegistry` service shape over a mutable entry list.
 * `register` prepends, so later registrations take precedence over built-ins.
 *
 * `resolve` is the hot-path entry: it picks an entry once for a pair and
 * returns a pure `(t) => T`. `interpolate` is sugar — same selection logic,
 * one-shot application. Both share `selectEntry` + `bind`, so semantics stay
 * lock-step.
 */
export const makeInterpolatorRegistry = (
  initial: ReadonlyArray<InterpolatorEntry<any>> = defaultInterpolators,
) =>
  Effect.sync(() => {
    const entries: Array<InterpolatorEntry<any>> = [...initial]

    const resolve = <From, To>(from: From, to: To): Effect.Effect<Blend<From, To>> =>
      Option.match(selectEntry(entries, from, to), {
        onNone: () => Effect.succeed(discreteBlend(from, to)),
        onSome: (entry) => bind(entry, from, to),
      })

    return {
      register: <T>(entry: InterpolatorEntry<T>) =>
        Effect.gen(function* () {
          entries.unshift(entry as InterpolatorEntry<any>)
          yield* Effect.logDebug("wardic.interpolator: register").pipe(
            Effect.annotateLogs({ interpolator: entry.name }),
          )
        }),
      resolve,
      interpolate: <From, To>(from: From, to: To, t: number): Effect.Effect<From | To> =>
        Effect.map(resolve(from, to), (fn) => fn(t)),
    }
  })

/** `InterpolatorRegistry` Layer pre-loaded with core's built-in interpolators. */
export const InterpolatorRegistryLive: Layer.Layer<InterpolatorRegistry> = Layer.effect(
  InterpolatorRegistry,
)(makeInterpolatorRegistry())
