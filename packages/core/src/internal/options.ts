/**
 * The option bags' decoding (#66, ADR-0025 *Amendment (#66)*): each bag a user writes (`SpringOptions`,
 * `TweenOptions`, `DecayOptions`, `InertiaOptions`, `AnimateOptions`) is the encoded side of a
 * Schema whose decoding fills in its defaults (`withDecodingDefault`) and rejects a value no
 * animation can take: NaN everywhere, `Infinity` everywhere but `repeat`, a negative duration or
 * delay, a non-positive stiffness, mass, rest threshold, friction or time constant, an edge `min`
 * above `max`. A rejected bag throws its `SchemaError`, naming the field: a defect, which each call
 * site contains to the one animation.
 *
 * Each resolver decodes once per bag: its result is cached by the bag's identity, so a Wardic
 * element's `transition`, the same object across its Retargets, is decoded once. A bag is read
 * once and never again: one changed after its first decode keeps the first result (the bags are
 * `readonly` in their types). None of this is on the per-frame path: a resolver runs when an
 * animation is built or started.
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
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

/** `schema` as an optional key that decodes to `value` when it's missing or `undefined`. */
export const withDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  Schema.withDecodingDefault<S>(Effect.succeed(value))(schema)

/**
 * A resolver for the bags `schema` decodes: it decodes a bag once, finishes the result with
 * `finish`, and caches it by the bag's identity. A bag `schema` rejects throws its `SchemaError`.
 */
export const cachedResolver = <S extends Schema.Decoder<unknown, never>, R>(
  schema: S,
  finish: (decoded: S["Type"]) => R,
): ((bag: object) => R) => {
  const decode = Schema.decodeUnknownSync(schema)
  const cache = new WeakMap<object, R>()
  return (bag) =>
    UndefinedOr.match(cache.get(bag), {
      onDefined: identity,
      onUndefined: () => {
        const resolved = finish(decode(bag))
        cache.set(bag, resolved)
        return resolved
      },
    })
}
