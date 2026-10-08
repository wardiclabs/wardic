import * as Option from "effect/Option"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaTransformation from "effect/SchemaTransformation"

/**
 * An Interpolator codec's transformation, built on its plain parse and plain format (ADR-0026).
 * `format` is the encode the frame calls directly, so each format is written once and
 * `Schema.encode` never runs per frame.
 *
 * Both directions are sync getters. `parse` returns `None` for a value of another kind, which
 * leaves the decode without a value, and Schema fails it with its bare `InvalidValue`
 * ("Expected a valid value"). Selection fails most decodes it tries, and a descriptive issue,
 * built in an effectful getter or a filter, cost each one about as much as the decode itself
 * (decision 9).
 */
export const parseAndFormat = <T, E>(
  parse: (input: E) => Option.Option<T>,
  format: (value: T) => E,
): SchemaTransformation.Transformation<T, E> =>
  SchemaTransformation.makeTransformation({
    decode: SchemaGetter.transformOptional((input: Option.Option<E>) => Option.flatMap(input, parse)),
    encode: SchemaGetter.transform(format),
  })
