/**
 * The headless Environment's reads of its Subjects' values, as core's ports take them: a raw value as
 * it is when it already has the target's type, a key's value in an object style, and an object style
 * as its record. A headless Subject has no units and no text form to read.
 *
 * @module
 */
// #672 (PR2-Q2): `testLayer`'s implementation of core's ports.
import * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"

/** No record: what a style that isn't an object reads as. */
const NONE: Readonly<Record<string, unknown>> = {}

/** The headless own values. */
export const ownValues: OwnValues.Shape = {
  valueLike: (raw, like) => {
    if (Predicate.isNumber(like)) {
      if (Predicate.isNumber(raw)) return Option.some(raw)
      return Option.none()
    }
    if (Predicate.isString(raw)) return Option.some(raw)
    return Option.none()
  },
  styleValueOf: (style, key) => {
    if (Predicate.isObject(style)) return Option.fromUndefinedOr((style as Readonly<Record<string, unknown>>)[key])
    return Option.none()
  },
  recordOf: (style) => {
    if (Predicate.isObject(style)) return style as Readonly<Record<string, unknown>>
    return NONE
  },
}

/** The headless ports, as `testLayer` gives them. */
export const layer: Layer.Layer<OwnValues.OwnValues> = Layer.succeed(OwnValues.OwnValues)(ownValues)
