import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaTransformation from "effect/SchemaTransformation"

/**
 * An Interpolator codec's transformation, built on its plain parse and plain format (ADR-0026).
 * `parse` returns `None` for a value of another kind, which fails the decode with an
 * `InvalidValue` issue; `format` is the encode the frame calls directly, so each format is
 * written once and `Schema.encode` never runs per frame.
 */
export const parseAndFormat = <T, E>(
  parse: (input: E) => Option.Option<T>,
  format: (value: T) => E,
  expected: string,
): SchemaTransformation.Transformation<T, E> =>
  SchemaTransformation.transformEffect({
    decode: (input: E) =>
      Option.match(parse(input), {
        onNone: () => Effect.fail(new SchemaIssue.InvalidValue({ expected }, input)),
        onSome: (value) => Effect.succeed(value),
      }),
    encode: (value: T) => Effect.succeed(format(value)),
  })
