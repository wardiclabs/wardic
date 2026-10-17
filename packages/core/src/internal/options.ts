/**
 * The option bags' decoding (#66, ADR-0025 *Amendment (#66)*): each bag a user writes (`SpringOptions`,
 * `TweenOptions`, `DecayOptions`, `InertiaOptions`, `AnimateOptions`) is the encoded side of a
 * Schema that rejects a value no animation can take: NaN everywhere, `Infinity` everywhere but
 * `repeat` and an edge, a negative duration or delay, a non-positive stiffness, mass, rest
 * threshold, friction or time constant, an edge `min` above `max`. A rejected bag throws its
 * `SchemaError`, naming the field: a defect, which each call site contains to the one animation.
 *
 * Each field is declared once, with its check and its default (`field`). The Schema checks it as an
 * optional key, and the resolver fills in the default after the decode. Schema's own
 * `withDecodingDefault` runs an Effect for each missing key, which made a decode 5–8× dearer
 * (about 12 µs cold in V8, against 2.3) and failed `bench:solid` for elements that carry their own
 * `transition` (the amendment's *Measured*).
 *
 * Each resolver decodes once per bag: its result is cached by the bag's identity, so a Wardic
 * element's `transition`, the same object across its Retargets, is decoded once. A bag is read
 * once and never again: one changed after its first decode keeps the first result (the bags are
 * `readonly` in their types). None of this is on the per-frame path: a resolver runs when an
 * animation is built or started.
 */
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"

/** A finite number above 0. */
export const Positive = Schema.Finite.check(Schema.isGreaterThan(0))

/** A finite number, 0 or above. */
export const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** Any number but NaN: an edge, where an infinite one means none. */
export const NotNaN = Schema.Number.check(
  Schema.makeFilter((n: number) => Bool.match(Number.isNaN(n), { onTrue: () => "Expected a number, not NaN", onFalse: () => true })),
)

/** A function, as an option bag's callbacks are (`easing`, `modifyTarget`). */
export const Fn = <F extends (...args: ReadonlyArray<never>) => unknown>(name: string) =>
  Schema.declare((u: unknown): u is F => Predicate.isFunction(u), { expected: name })

/** A bag's field: its check, and the value it takes when it's missing or `undefined`. */
export interface Field<S extends Schema.Top, A> {
  readonly schema: S
  readonly value: A
}

/** A field checked when given, `value` when it's missing or `undefined`. */
export const field = <S extends Schema.Top>(schema: S, value: S["Type"]): Field<S, S["Type"]> => ({ schema, value })

/** A field checked when given, and left missing otherwise (a spring's `from` and `velocity`, `init`'s). */
export const optionalField = <S extends Schema.Top>(schema: S): Field<S, S["Type"] | undefined> => ({ schema, value: undefined })

/** A bag's fields, by key. */
export type Fields = Readonly<Record<string, Field<Schema.Decoder<unknown>, unknown>>>

/** A bag decoded, each field's default filled in. */
export type Filled<F extends Fields> = { readonly [K in keyof F]: F[K]["value"] }

/** `decoded` with each of `fields`' defaults where it's missing. */
const fill = <F extends Fields>(fields: F, decoded: Readonly<Record<string, unknown>>): Filled<F> =>
  Rec.map(fields, (f, key) => UndefinedOr.match(decoded[key], { onUndefined: () => f.value, onDefined: identity })) as Filled<F>

/**
 * A resolver for the bags `fields` describe: it decodes a bag once (each field an optional key,
 * checked when given; then `check` across the filled fields, if any), fills in each default,
 * finishes the result with `finish`, and caches it by the bag's identity. A bag the decode rejects
 * throws its `SchemaError`.
 */
export const cachedResolver = <F extends Fields, R>(
  fields: F,
  finish: (filled: Filled<F>) => R,
  check?: (filled: Filled<F>) => true | string,
): ((bag: object) => R) => {
  const struct = Schema.Struct(Rec.map(fields, (f) => Schema.optional(f.schema)))
  const schema: Schema.Decoder<unknown> = UndefinedOr.match(check, {
    onUndefined: (): Schema.Decoder<unknown> => struct,
    onDefined: (across): Schema.Decoder<unknown> =>
      struct.check(Schema.makeFilter((decoded: Readonly<Record<string, unknown>>) => across(fill(fields, decoded)))),
  })
  const decode = Schema.decodeUnknownSync(schema)
  const cache = new WeakMap<object, R>()
  return (bag) =>
    UndefinedOr.match(cache.get(bag), {
      onDefined: identity,
      onUndefined: () => {
        const resolved = finish(fill(fields, decode(bag) as Readonly<Record<string, unknown>>))
        cache.set(bag, resolved)
        return resolved
      },
    })
}
