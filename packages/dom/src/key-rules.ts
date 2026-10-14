/**
 * The DOM Environment's **Key rules** (CONTEXT.md; ADR-0035): how a CSS property's pair blends,
 * by the property's name, which core's `InterpolatorRegistry` asks before blending a pair by value.
 * Core holds none. Both rules take a key by its CSS name or in camelCase (`box-shadow`, `boxShadow`):
 * `WardicValues` types keys as CSS names, and camelCase works as well.
 *
 * - **`visibility`** (ADR-0024, decision 4): `display` and `visibility` turning to `none` or
 *   `hidden` show their start until the run's last Frame (Motion's `mixVisibility`), keyed on the
 *   Frame's `done`, so a spring crossing its target can't flicker them.
 * - **`animatableNone`** (ADR-0015, *Amendment (#61)*): an empty end (`"none"`, `0`, `"0"`, a zero
 *   with a unit) facing a complex value or a lone colour stands for that value at zero, numbers 0
 *   and colours transparent (Motion's `getAnimatableNone`). A filter puts each function at its
 *   identity and a mask keeps its colours opaque. A plain length isn't a template: `none` isn't 0
 *   for `max-height`. A shadow list (`box-shadow`, `text-shadow`) blends shadow by shadow: a length
 *   missing from the start's shadow counts as 0, and a missing shadow grows from its zero. Either
 *   way the run's last Frame writes the target as given, so a shadow, filter or fill animated to
 *   `none` rests at `none`, with no stacking context, containing block or painted fill left.
 *
 * Each rule declines synchronously, allocating nothing, for a key it can't take: the registry asks
 * every rule for every key of every leg it builds. The blends they hand back are on the per-frame
 * path (ADR-0025): statement `if`s, and a counted loop for a shadow list.
 *
 * @module
 */
import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { dashCase } from "./svg.ts"

/** A value a key blends: a number or a string. */
type Value = number | string

/** A pair the registry blends by value. */
type Pair = readonly [from: Value, to: Value]

/** A key's pairs, from the Animatable none rule: one, or, for a shadow list, one per shadow. */
interface Prepared {
  readonly pairs: ReadonlyArray<Pair>
}

const decodeComplex = Schema.decodeUnknownOption(Interpolator.ComplexString)
const encodeComplex = Schema.encodeSync(Interpolator.ComplexString)
const decodeColor = Schema.decodeUnknownOption(Interpolator.ColorString)
const encodeColor = Schema.encodeSync(Interpolator.ColorString)

/** The keys whose empty end takes each filter function's identity (Motion's `filter` type, and the backdrop it leaves out). */
const FILTER_KEYS: ReadonlySet<string> = new Set(["filter", "-webkit-filter", "backdrop-filter", "-webkit-backdrop-filter"])
/** The keys whose empty end keeps its colours opaque (Motion's `mask` type, and the images it leaves out). */
const MASK_KEYS: ReadonlySet<string> = new Set(["mask", "-webkit-mask", "mask-image", "-webkit-mask-image"])
/** The keys matched shadow by shadow. */
const SHADOW_KEYS: ReadonlySet<string> = new Set(["box-shadow", "text-shadow"])

/** Whether `key`, written either way, is in `keys`. */
const isOneOf =
  (keys: ReadonlySet<string>): Predicate.Predicate<string> =>
  (key) =>
    keys.has(dashCase(key))

/** The filter functions whose identity is 1 (or 100%); every other is at its identity at 0 (Motion's `maxDefaults`). */
const IDENTITY_ONE: ReadonlySet<string> = new Set(["brightness", "contrast", "saturate", "opacity"])

/** The words an empty end can be. */
const EMPTY_WORDS: ReadonlySet<string> = new Set(["none", "0"])
/** A zero with a unit: `"0px"`, `"0%"`, `"0deg"` (Motion's `isZeroValueString`). */
const ZERO_WITH_UNIT_RE = /^0[^.\s]+$/

/** An empty string end: `"none"`, `"0"`, or a zero with a unit. */
const isEmptyWord: Predicate.Predicate<string> = Predicate.mapInput(
  Predicate.or((word: string) => EMPTY_WORDS.has(word), (word: string) => ZERO_WITH_UNIT_RE.test(word)),
  Str.trim,
)

/** The number 0. */
const isZero: Predicate.Predicate<Value> = (value) => value === 0

/** An empty end (Motion's `isNone`): the number 0, `"none"`, `"0"`, or a zero with a unit. */
const isEmptyEnd: Predicate.Predicate<Value> = Predicate.or(isZero, (value: Value) => Predicate.isString(value) && isEmptyWord(value))

/** The first number in a filter function's arguments. */
const FIRST_NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/i

/** How an empty end's colours turn: transparent, or opaque in a mask. */
type ColorTurn = (color: object) => object

const transparent: ColorTurn = (color) => ({ ...color, alpha: 0 })
const opaque: ColorTurn = (color) => ({ ...color, alpha: 1 })

/** A number written straight after a `/`: a `calc()` divisor, kept, since a 0 there is NaN (Motion's `convertToZero`). */
const isDivisor = (partBefore: string): boolean => Str.endsWith("/")(Str.trim(partBefore))

/** A complex value at zero: every number 0 (but a divisor), every colour turned. */
const zeroComplex = (complex: Interpolator.Complex, turn: ColorTurn): string =>
  encodeComplex({
    parts: complex.parts,
    tokens: Arr.map(complex.tokens, (token, i): Interpolator.ComplexToken =>
      Match.value(token).pipe(
        Match.when(Predicate.isNumber, (n) =>
          Bool.match(isDivisor(complex.parts[i]), { onTrue: () => n, onFalse: () => 0 })),
        Match.orElse((color) => turn(color) as Interpolator.ComplexToken),
      )),
  })

/** A value at zero, as a complex value or a lone colour; `None` when it's neither. */
const zeroOf = (value: string, turn: ColorTurn): Option.Option<string> =>
  Option.orElse(
    Option.map(decodeComplex(value), (complex) => zeroComplex(complex, turn)),
    () => Option.map(decodeColor(value), (color) => encodeColor(turn(color) as typeof color)),
  )

/** How many numbers a complex value holds outside its colours: what complex matching counts. 0 for one that isn't. */
const numberCountOf = (value: string): number =>
  Option.match(decodeComplex(value), {
    onNone: () => 0,
    onSome: (complex) => Arr.filter(complex.tokens, Predicate.isNumber).length,
  })

/** A top-level comma: one not inside a bracket (a shadow's colour, `rgba(…)`, holds commas). One level deep, as shadows are. */
const TOP_LEVEL_COMMA_RE = /,(?![^(]*\))/

/** A filter's functions, each with what's in its brackets, one bracket level deep (`drop-shadow(0px 0px 4px rgb(…))`). */
const FILTER_FUNCTION_RE = /[a-z-]+\((?:[^()]|\([^()]*\))*\)/gi

/** A shadow list's shadows, trimmed. */
const shadowsOf = (value: string): ReadonlyArray<string> => Arr.filter(Arr.map(value.split(TOP_LEVEL_COMMA_RE), Str.trim), Str.isNonEmpty)

/** A filter's functions. */
const filterFunctionsOf = (value: string): ReadonlyArray<string> => Option.getOrElse(Str.match(FILTER_FUNCTION_RE)(value), () => [])

/**
 * One filter function at its identity (Motion's `applyDefaultFilter`): its first number becomes 1
 * (or 100) for `brightness`, `contrast`, `saturate` and `opacity`, 0 for the rest, keeping its unit.
 * A `drop-shadow()` grows from a transparent zero, as a shadow does (#61; Motion keeps it as is).
 * One with no number (`url(#f)`) stays as it is.
 */
const filterFunctionAtIdentity = (fn: string): string => {
  const name = Str.trim(fn.slice(0, Math.max(0, fn.indexOf("("))))
  const args = fn.slice(fn.indexOf("(") + 1, fn.lastIndexOf(")"))
  return Bool.match(name === "drop-shadow", {
    onTrue: () => Option.getOrElse(zeroOf(fn, transparent), () => fn),
    onFalse: () =>
      Option.match(Option.fromNullishOr(FIRST_NUMBER_RE.exec(args)), {
        onNone: () => fn,
        onSome: ([number]) => {
          const unit = Str.replace(number, "")(args)
          const one = Bool.match(Str.isEmpty(unit), { onTrue: () => 1, onFalse: () => 100 })
          const identity = Bool.match(IDENTITY_ONE.has(name), { onTrue: () => one, onFalse: () => 0 })
          return `${name}(${identity}${unit})`
        },
      }),
  })
}

/** A filter at its identity: each top-level function at its own (Motion's `filter.getAnimatableNone`). */
const filterAtIdentity = (value: string): Option.Option<string> =>
  Option.map(decodeComplex(value), () => Arr.join(Arr.map(filterFunctionsOf(value), filterFunctionAtIdentity), " "))

/** What `key`'s empty end stands for, facing `template` (CONTEXT.md's Animatable none); `None` when `template` can't be one. */
const noneOf = (key: string, template: string): Option.Option<string> =>
  Bool.match(isOneOf(FILTER_KEYS)(key), {
    onTrue: () => filterAtIdentity(template),
    onFalse: () => zeroOf(template, Bool.match(isOneOf(MASK_KEYS)(key), { onTrue: () => opaque, onFalse: () => transparent })),
  })

/** `auto`, which carries nothing to grow from. */
const isAuto: Predicate.Predicate<string> = (s) => Str.trim(s) === "auto"

/** An end a template can come from: a string other than an empty end or `auto`. */
const templateOf = (value: Value): Option.Option<string> =>
  Option.filter(Option.liftPredicate(value, Predicate.isString), Predicate.not(Predicate.or(isEmptyWord, isAuto)))

/** `from` empty and `to` a template: the pair from `to`'s Animatable none. */
const fromNone = (key: string, from: Value, to: Value): Option.Option<Prepared> =>
  pipe(
    Option.liftPredicate(from, isEmptyEnd),
    Option.flatMap(() => templateOf(to)),
    Option.flatMap((template) => noneOf(key, template)),
    Option.map((none): Prepared => ({ pairs: [[none, to]] })),
  )

/** `to` empty and `from` a template: the pair to `from`'s Animatable none, landing on `to` as given. */
const toNone = (key: string, from: Value, to: Value): Option.Option<Prepared> =>
  pipe(
    Option.liftPredicate(to, isEmptyEnd),
    Option.flatMap(() => templateOf(from)),
    Option.flatMap((template) => noneOf(key, template)),
    Option.map((none): Prepared => ({ pairs: [[from, none]] })),
  )


/**
 * One shadow's pair: a shadow missing from one end is the other's Animatable none, and a start
 * with fewer numbers than its target takes 0s for the missing lengths, appended (CSS's default
 * for an omitted blur or spread). Matching is kind by kind in order, so where they go in the text
 * doesn't matter.
 */
const shadowPair = (from: Option.Option<string>, to: Option.Option<string>): Pair => {
  const a = Option.getOrElse(from, () => Option.getOrElse(Option.flatMap(to, (t) => zeroOf(t, transparent)), () => "none"))
  const b = Option.getOrElse(to, () => Option.getOrElse(Option.flatMap(from, (f) => zeroOf(f, transparent)), () => "none"))
  const missing = Math.max(0, numberCountOf(b) - numberCountOf(a))
  return [a + Str.repeat(missing)(" 0px"), b]
}

/** One pair, `from` → `to` as given: matching shadow by shadow changed nothing. */
const isAsGiven =
  (from: Value, to: Value): Predicate.Predicate<ReadonlyArray<Pair>> =>
  (pairs) =>
    Arr.match(pairs, {
      onEmpty: () => false,
      onNonEmpty: ([[a, b], ...rest]) => Bool.and(rest.length === 0, Bool.and(a === from, b === to)),
    })

/**
 * A shadow list's pairs, shadow by shadow (#61): `None` unless both ends are strings and matching
 * them shadow by shadow changes anything (more than one shadow, or a start short of numbers).
 */
const shadows = (key: string, from: Value, to: Value): Option.Option<Prepared> =>
  pipe(
    Option.liftPredicate(key, isOneOf(SHADOW_KEYS)),
    Option.flatMap(() => Option.all([Option.liftPredicate(from, Predicate.isString), Option.liftPredicate(to, Predicate.isString)])),
    Option.map(([a, b]) => {
      const as = shadowsOf(a)
      const bs = shadowsOf(b)
      return Arr.makeBy(Math.max(as.length, bs.length), (i) => shadowPair(Arr.get(as, i), Arr.get(bs, i)))
    }),
    Option.filter(Predicate.not(isAsGiven(from, to))),
    Option.map((pairs): Prepared => ({ pairs })),
  )

/** An end a template can come from, checked cheaply: a string other than an empty end or `auto`. */
const isTemplateEnd: Predicate.Predicate<Value> = (value) => Predicate.isString(value) && !isEmptyWord(value) && !isAuto(value)

/**
 * Whether any rule here can apply: an empty end facing a template, or a shadow key between two
 * strings. Checked first, allocating nothing, so a pair no rule applies to (`opacity` from `0`,
 * `pointer-events` to `none`) never reaches the `Option` chains below: their calls at stream
 * build, through library functions the frame path shares, cost Node's `animateValues` about 5%
 * per frame when it ran after other workloads (#61's bench).
 */
const mayApply = (key: string, from: Value, to: Value): boolean =>
  Bool.or(
    Bool.or(Bool.and(isEmptyEnd(from), isTemplateEnd(to)), Bool.and(isEmptyEnd(to), isTemplateEnd(from))),
    Bool.and(isOneOf(SHADOW_KEYS)(key), Bool.and(Predicate.isString(from), Predicate.isString(to))),
  )

/**
 * `key`'s pairs (#61): from or to its Animatable none when one end is empty, or shadow by shadow
 * for a shadow list. `None` when neither applies: the rule declines.
 */
const prepare = (key: string, from: Value, to: Value): Option.Option<Prepared> => {
  if (!mayApply(key, from, to)) return Option.none()
  return pipe(
    fromNone(key, from, to),
    Option.orElse(() => toNone(key, from, to)),
    Option.orElse(() => shadows(key, from, to)),
  )
}

// --- The blends the rules hand back: on the per-frame path ---------------------------------------

/** One pair's blend, by value. */
type Blend = (t: number) => number | string

/** A hiding pair's blend: its start until the run's last Frame, then its target. Per frame: a statement `if`. */
const holdUntilDone =
  (from: Value, to: Value): InterpolatorRegistry.KeyBlend =>
  (_t, done) => {
    if (done) return to
    return from
  }

/**
 * One pair's blend that writes its target as given on the run's last Frame (#61): a pair from or to
 * its Animatable none rests at `"none"` itself, not its zero. Per frame: a statement `if`.
 */
const landOn =
  (blend: Blend, to: Value): InterpolatorRegistry.KeyBlend =>
  (t, done) => {
    if (done) return to
    return blend(t)
  }

/**
 * A shadow list's blend (#61): each shadow's blend, joined with `", "`, and its target as given on
 * the run's last Frame. Per frame: a counted loop building the string.
 */
const joinShadows =
  (blends: ReadonlyArray<Blend>, to: Value): InterpolatorRegistry.KeyBlend =>
  (t, done) => {
    if (done) return to
    let out = String(blends[0](t))
    for (let i = 1; i < blends.length; i++) out += ", " + String(blends[i](t))
    return out
  }

// --- The rules ------------------------------------------------------------------------------------

/** The keys whose turn to `none` or `hidden` waits for the run's last Frame (ADR-0024, decision 4). */
const VISIBILITY_KEYS: ReadonlySet<string> = new Set(["display", "visibility"])
const INVISIBLE: ReadonlySet<string> = new Set(["none", "hidden"])

/** A `none` or `hidden` value: what a `display` or `visibility` key turns to when it hides. */
const isInvisible: Predicate.Predicate<Value> = (value) => Predicate.isString(value) && INVISIBLE.has(Str.trim(value))

/** A pair that hides: from a visible value to `none` or `hidden`. */
const hides = (from: Value, to: Value): boolean => Bool.and(isInvisible(to), !isInvisible(from))

/** `display` and `visibility`, turning to `none` or `hidden`, show their start until the run's last Frame. */
export const visibility: InterpolatorRegistry.KeyRule = {
  name: "visibility",
  blend: (key, from, to) => {
    if (!VISIBILITY_KEYS.has(key)) return Option.none()
    if (!hides(from, to)) return Option.none()
    return Option.some(Effect.succeed(holdUntilDone(from, to)))
  },
}

/**
 * An empty end facing a complex value or a colour grows from, or goes back to, its Animatable none,
 * and a shadow list blends shadow by shadow; the run's last Frame writes the target as given.
 */
export const animatableNone: InterpolatorRegistry.KeyRule = {
  name: "animatable none",
  blend: (key, from, to, resolve) =>
    Option.map(prepare(key, from, to), (prepared) =>
      Effect.map(
        Effect.forEach(prepared.pairs, ([a, b]) => resolve(a, b)),
        (blends): InterpolatorRegistry.KeyBlend =>
          Bool.match(blends.length > 1, {
            onTrue: () => joinShadows(blends, to),
            onFalse: () => landOn(blends[0], to),
          }),
      )),
}

/** The DOM Environment's Key rules, in precedence order. */
export const keyRules: ReadonlyArray<InterpolatorRegistry.KeyRule> = [visibility, animatableNone]
