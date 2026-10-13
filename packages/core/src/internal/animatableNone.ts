/**
 * The Animatable none and the shadow rule (#61, ADR-0015 *Amendment (#61)*; CONTEXT.md), which
 * `Machine.ts`' `blendersFor` applies to each key's pair before the `InterpolatorRegistry`
 * resolves it. Keyed by name, as the `display` / `visibility` rule is: the registry resolves a
 * pair by value only. Not importable from outside core (`package.json`'s `"./internal/*": null`).
 *
 * - **An empty end** (`"none"`, `0`, `"0"`, a zero with a unit like `"0px"`; Motion's `isNone`)
 *   facing a complex value or a lone colour stands for that value at zero: every number 0 and every
 *   colour transparent (Motion's `getAnimatableNone`). A filter puts each function at its identity
 *   and a mask keeps its colours opaque. A plain length (`"100px"`) isn't a template: `none` isn't
 *   0 for `max-height`.
 * - **A shadow** (`boxShadow`, `textShadow`) is a list, matched shadow by shadow: a length missing
 *   from the start's shadow counts as 0, CSS's default, and a shadow missing from one end grows from
 *   its Animatable none.
 *
 * Either way the leg's last frame writes its target as given, so a shadow, filter or fill
 * that animates to `"none"` rests at `"none"`, with no stacking context, containing block or
 * painted fill left behind.
 *
 * Runs when a stream is built, never per frame.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity, pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Interpolator from "../Interpolator.ts"
import { numberCountOf } from "./complexTokens.ts"

/** A value a key blends: a number or a string. */
type Value = number | string

/** A pair, ready for the registry. */
type Pair = readonly [from: Value, to: Value]

/**
 * A key's pair as the registry resolves it: one pair, or, for a shadow list, one per shadow,
 * joined with `", "` each frame. Either way the leg's last frame writes the target as given.
 */
export interface Prepared {
  readonly pairs: ReadonlyArray<Pair>
}

const decodeComplex = Schema.decodeUnknownOption(Interpolator.ComplexString)
const encodeComplex = Schema.encodeSync(Interpolator.ComplexString)
const decodeColor = Schema.decodeUnknownOption(Interpolator.ColorString)
const encodeColor = Schema.encodeSync(Interpolator.ColorString)

/**
 * A key as its CSS property name: `boxShadow` → `box-shadow`, `WebkitFilter` → `-webkit-filter`.
 * Keys come both ways: `WardicValues` types them as CSS names, and camelCase works as well.
 */
const cssNameOf = (key: string): string =>
  UndefinedOr.match(CSS_NAMES.get(key), {
    onDefined: identity,
    onUndefined: () => {
      const name = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      CSS_NAMES.set(key, name)
      return name
    },
  })

/** Each key's CSS name, once: keys repeat across elements and legs. */
const CSS_NAMES = new Map<string, string>()

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
    keys.has(cssNameOf(key))

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
const animatableNone = (key: string, template: string): Option.Option<string> =>
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
    Option.flatMap((template) => animatableNone(key, template)),
    Option.map((none): Prepared => ({ pairs: [[none, to]] })),
  )

/** `to` empty and `from` a template: the pair to `from`'s Animatable none, landing on `to` as given. */
const toNone = (key: string, from: Value, to: Value): Option.Option<Prepared> =>
  pipe(
    Option.liftPredicate(to, isEmptyEnd),
    Option.flatMap(() => templateOf(from)),
    Option.flatMap((template) => animatableNone(key, template)),
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
 * `key`'s pair, ready for the registry (#61): from or to its Animatable none when one end is empty,
 * or shadow by shadow for a shadow list. `None` when no rule applies: the pair is resolved as it is.
 */
export const prepare = (key: string, from: Value, to: Value): Option.Option<Prepared> => {
  if (!mayApply(key, from, to)) return Option.none()
  return pipe(
    fromNone(key, from, to),
    Option.orElse(() => toNone(key, from, to)),
    Option.orElse(() => shadows(key, from, to)),
  )
}
