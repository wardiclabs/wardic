/**
 * The option bags' checks (#66, ADR-0025 *Amendment (#66)*; by hand since #511, ADR-0067 decision 9,
 * ADR-0025 *Amendment (#511)*): each bag a user writes (`SpringOptions`, `TweenOptions`,
 * `DecayOptions`, `InertiaOptions`, `AnimateOptions`, `KeyframesOptions`) is checked field by field,
 * rejecting a value no animation can take: NaN everywhere, `Infinity` everywhere but `repeat` and an
 * edge, a negative duration or delay, a non-positive stiffness, mass, rest threshold, friction or
 * time constant, an edge `min` above `max`. A rejected bag throws an {@link OptionError} naming the
 * field, in the words Schema's decode used (`Expected a value greater than 0` then `  at ["stiffness"]`):
 * a defect, which each call site contains to the one animation.
 *
 * Each field is declared once, with its check and its default (`field`). A missing or `undefined`
 * field takes its default; a given one is checked. Then a bag's cross-field `check`, if any, reads
 * the filled fields.
 *
 * Each resolver checks once per bag: its result is cached by the bag's identity, so a Wardic
 * element's `transition`, the same object across its Retargets, is checked once. A bag is read
 * once and never again: one changed after its first check keeps the first result (the bags are
 * `readonly` in their types). None of this is on the per-frame path: a resolver runs when an
 * animation is built or started.
 */
import * as Arr from "effect/Array"
import * as Data from "effect/Data"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"

/**
 * Options an animation can't take, a negative duration say: its message names the field and what it
 * expected, `Expected a value greater than 0` then `  at ["stiffness"]`. Thrown as the animation is
 * built or started: a bug to fix, not a failure to handle. `Machine.OptionError`.
 */
// #511: checked by hand since then.
export class OptionError extends Data.TaggedError("OptionError")<{
  readonly message: string
}> {}

/**
 * A check on one value (#511): `true`, or its failure, the message as it reads at the value: one
 * issue a line, `Expected …` (or `Missing key`), each followed by `  at [i]` when it's below the
 * value, as Schema wrote them. Callable as `(value: unknown) => true | string`.
 *
 * It names the values it takes, as Schema's types did: `takes` by their runtime type, and `type` in
 * words (`number`, `"loop" | "reverse"`, `an easing function`). A {@link union} asks only the members
 * that take a value, and a field rejects a value its check doesn't take as `Expected <type> | undefined`.
 */
export interface Check<A = unknown> {
  (value: unknown): true | string
  /** The values it takes, in words: what a field or a union expected when none of them was given. */
  readonly type: string
  /** Whether it takes a value of this runtime type at all. */
  readonly takes: (value: unknown) => boolean
  /** What a value it passes is: for the types only, never set. */
  readonly Type?: A
}

/** What a check passes. */
type TypeOf<C> = C extends { readonly Type?: infer A } ? A : never

/** A check from its parts. */
export const make = <A>(type: string, takes: (value: unknown) => boolean, test: (value: unknown) => true | string): Check<A> =>
  Object.assign(test, { type, takes })

/** What was expected, as a failure. */
const expected = (what: string): string => `Expected ${what}`

const MISSING = "Missing key"
const EXCESS = expected("no excess property")
const AT = "  at "
const isAt = Str.startsWith(AT)

/** One line of a failure placed under `segment`: its place, or an issue with none yet, which takes `segment`. */
const placed = (segment: string, line: string, next: Option.Option<string>): ReadonlyArray<string> => {
  if (isAt(line)) return [AT + segment + line.slice(AT.length)]
  if (Option.exists(next, isAt)) return [line]
  return [line, AT + segment]
}

/**
 * `failure` one place down, at `segment` (`["ease"]`, `[3]`): each issue's place starts there, as
 * Schema's path did (`  at ["ease"][3]`). Only when a check fails.
 */
const under = (segment: string, failure: string): string => {
  const lines = Str.split(failure, "\n")
  return Arr.join(Arr.flatMap(lines, (line, i) => placed(segment, line, Arr.get(lines, i + 1))), "\n")
}

/** A check that passes `value`. */
const passes = (value: unknown) => (check: Check<unknown>): boolean => check(value) === true

/** A failure's message: `true` is none. */
const failureOf = (result: true | string): string => {
  if (result === true) return ""
  return result
}

/** A check that runs `refinement` on what `check` passes: `check`'s type, and its failure first. */
export const refine = <A>(check: Check<A>, refinement: (value: A) => true | string): Check<A> =>
  make(check.type, check.takes, (value) => {
    const checked = check(value)
    if (checked !== true) return checked
    return refinement(value as A)
  })

const NOT_NUMBER = expected("number")

/** Any number, NaN and the infinities too. */
export const number: Check<number> = make("number", Predicate.isNumber, (value) => Predicate.isNumber(value) || NOT_NUMBER)

const NOT_FINITE = expected("a finite number")
const NOT_POSITIVE = expected("a value greater than 0")
const NEGATIVE = expected("a value greater than or equal to 0")
const NAN = expected("a number, not NaN")

/** A finite number. */
export const finite: Check<number> = refine(number, (n) => Number.isFinite(n) || NOT_FINITE)

/** A finite number above 0. */
export const positive: Check<number> = refine(finite, (n) => n > 0 || NOT_POSITIVE)

/** A finite number, 0 or above. */
export const nonNegative: Check<number> = refine(finite, (n) => n >= 0 || NEGATIVE)

/** Any number but NaN: an edge, where an infinite one means none. */
export const notNaN: Check<number> = refine(number, (n) => !Number.isNaN(n) || NAN)

const NOT_BOOLEAN = expected("boolean")

/** A boolean. */
export const boolean: Check<boolean> = make("boolean", Predicate.isBoolean, (value) => Predicate.isBoolean(value) || NOT_BOOLEAN)

/** A function, as an option bag's callbacks are (`ease`, `modifyTarget`), named by what it is: it takes a value of any type. */
export const fn = <F extends (...args: ReadonlyArray<never>) => unknown>(name: string): Check<F> => {
  const failure = expected(name)
  return make(name, Predicate.isUnknown, (value) => Predicate.isFunction(value) || failure)
}

/** One of `values`: a string, `Expected "loop" | "reverse" | "mirror"` otherwise. */
export const literals = <const L extends string>(values: ReadonlyArray<L>): Check<L> => {
  const type = Arr.join(Arr.map(values, (literal) => JSON.stringify(literal)), " | ")
  const failure = expected(type)
  const known: ReadonlySet<unknown> = new Set(values)
  return make(type, Predicate.isString, (value) => known.has(value) || failure)
}

/**
 * Any of `members`, as Schema's union read one: it asks the members that take the value's runtime
 * type, in order, and passes when one passes. Its failure is theirs, each on its lines; with none
 * that takes it, `Expected` their types (`number | undefined`).
 */
export const union = <const Cs extends ReadonlyArray<Check<any>>>(members: Cs): Check<TypeOf<Cs[number]>> => {
  const type = Arr.join(Arr.dedupe(Arr.map(members, (member) => member.type)), " | ")
  const failure = expected(type)
  const takes = (value: unknown): boolean => Arr.some(members, (member) => member.takes(value))
  return make(type, takes, (value) => {
    const candidates = Arr.filter(members, (member) => member.takes(value))
    if (candidates.length === 0) return failure
    if (Arr.some(candidates, passes(value))) return true
    return Arr.join(Arr.map(candidates, (member) => failureOf(member(value))), "\n")
  })
}

const NOT_ARRAY = expected("array")

/** `element`'s failure for the value at index `i`, under it, or `None`. */
const elementFailure = (element: Check<unknown>, value: unknown, i: number): Option.Option<string> => {
  const checked = element(value)
  if (checked === true) return Option.none()
  return Option.some(under(`[${i}]`, checked))
}

/** The first of `values` that `element` rejects, its failure under its index, or `true`. */
const elementsOf = (element: Check<unknown>, values: ReadonlyArray<unknown>): true | string =>
  Option.getOrElse(Arr.findFirst(values, (value, i) => elementFailure(element, value, i)), (): true => true)

/** An array, each element passing `element`. */
export const array = <A>(element: Check<A>): Check<ReadonlyArray<A>> =>
  make("array", Arr.isArray, (value) => {
    if (!Arr.isArray(value)) return NOT_ARRAY
    return elementsOf(element, value)
  })

/** An array of one element or more, each passing `element`: an empty one is missing its first. */
export const nonEmptyArray = <A>(element: Check<A>): Check<Arr.NonEmptyReadonlyArray<A>> =>
  make("array", Arr.isArray, (value) => {
    if (!Arr.isArray(value)) return NOT_ARRAY
    if (value.length === 0) return under("[0]", MISSING)
    return elementsOf(element, value)
  })

/** The tuple `elements`' failure at index `i` of `values`: missing, or its element's. */
const tupleElementFailure = (values: ReadonlyArray<unknown>) => (element: Check<unknown>, i: number): Option.Option<string> => {
  if (i >= values.length) return Option.some(under(`[${i}]`, MISSING))
  return elementFailure(element, values[i], i)
}

/** An array of exactly `elements`' length, each passing its own: a missing one, then one past the end, fail. */
export const tuple = <const Cs extends ReadonlyArray<Check<any>>>(elements: Cs): Check<{ readonly [K in keyof Cs]: TypeOf<Cs[K]> }> =>
  make("array", Arr.isArray, (value) => {
    if (!Arr.isArray(value)) return NOT_ARRAY
    const failure = Arr.findFirst(elements, tupleElementFailure(value))
    if (Option.isSome(failure)) return failure.value
    if (value.length > elements.length) return under(`[${elements.length}]`, EXCESS)
    return true
  })

/** A bag's field: its check, and the value it takes when it's missing or `undefined`. */
export interface Field<A> {
  readonly check: Check<A>
  readonly value: A
}

/** A field checked when given, `value` when it's missing or `undefined`. */
export const field = <A>(check: Check<A>, value: NoInfer<A>): Field<A> => ({ check, value })

/** A field checked when given, and left missing otherwise (a spring's `from` and `velocity`, `init`'s). */
export const optionalField = <A>(check: Check<A>): Field<A | undefined> => ({ check, value: undefined })

/** A bag's fields, by key. */
export type Fields = Readonly<Record<string, Field<unknown>>>

/** A bag checked, each field's default filled in. */
export type Filled<F extends Fields> = { readonly [K in keyof F]: F[K]["value"] }

/** A field, by its key and as its place in a failure (`["stiffness"]`), built once a resolver. */
type Entry = readonly [key: string, segment: string, field: Field<unknown>]

/** A given value's failure as its field reads it: one its check doesn't take is the wrong type, `| undefined` beside it. */
const fieldFailure = (check: Check<unknown>, given: unknown): true | string => {
  if (!check.takes(given)) return expected(`${check.type} | undefined`)
  return check(given)
}

/** `bag`'s value for a field: its default when it's missing or `undefined`, else as given, checked. */
const valueOf = (bag: Readonly<Record<string, unknown>>, [key, segment, f]: Entry): unknown => {
  const given = bag[key]
  if (Predicate.isUndefined(given)) return f.value
  const checked = fieldFailure(f.check, given)
  if (checked !== true) throw new OptionError({ message: under(segment, checked) })
  return given
}

const NOT_OBJECT = expected("object")

/** A bag must be an object: not `null`, an array or a function. */
const isBag = (bag: unknown): bag is Readonly<Record<string, unknown>> => Predicate.isObject(bag)

/**
 * A resolver for the bags `fields` describe: it checks a bag once (each field when given, in
 * `fields`' order, the first rejected one throwing; then `check` across the filled fields, if any),
 * fills in each default, finishes the result with `finish`, and caches it by the bag's identity. A
 * bag it rejects throws its {@link OptionError}.
 */
export const cachedResolver = <F extends Fields, R>(
  fields: F,
  finish: (filled: Filled<F>) => R,
  check?: (filled: Filled<F>) => true | string,
): ((bag: object) => R) => {
  const entries: ReadonlyArray<Entry> = Arr.map(Rec.toEntries(fields), ([key, f]): Entry => [key, `[${JSON.stringify(key)}]`, f])
  const across = (filled: Filled<F>): true | string => {
    if (Predicate.isUndefined(check)) return true
    return check(filled)
  }
  const fill = (bag: object): Filled<F> => {
    if (!isBag(bag)) throw new OptionError({ message: NOT_OBJECT })
    const filled = Arr.reduce(entries, {} as Record<string, unknown>, (out, entry) => {
      out[entry[0]] = valueOf(bag, entry)
      return out
    }) as Filled<F>
    const checked = across(filled)
    if (checked !== true) throw new OptionError({ message: checked })
    return filled
  }
  const cache = new WeakMap<object, R>()
  // Per leg (#460, compose once): statements.
  return (bag) => {
    const cached = cache.get(bag)
    if (Predicate.isNotUndefined(cached)) return cached
    const resolved = finish(fill(bag))
    cache.set(bag, resolved)
    return resolved
  }
}
