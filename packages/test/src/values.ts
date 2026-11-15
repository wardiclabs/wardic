/**
 * The headless Environment's reads of its Subjects' values, as core's ports take them: a raw value as
 * it is when it already has the target's type, a key's value in an object style, and an object style
 * as its record; and no Measured pair or Variable value, since a headless Subject has no units, no
 * text form and no variables to read.
 *
 * @module
 */
// #672 (PR2-Q2): `testLayer`'s implementation of core's ports.
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as MeasuredPairs from "@wardic/core/unstable/MeasuredPairs"
import * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as VariableValues from "@wardic/core/unstable/VariableValues"
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

/** No pair asked: what a measure that needs none returns. */
const NO_PAIRS: Readonly<Record<string, MeasuredPairs.Requested>> = {}

/** The headless Measured pairs: none needed, so none measured. */
export const measuredPairs: MeasuredPairs.Shape = {
  needs: () => false,
  measure: () => NO_PAIRS,
}

/** A Key rule that declines every pair: a headless Subject has no variables. */
const NO_VARIABLES: InterpolatorRegistry.KeyRule = { name: "no variable values", blend: () => Option.none() }

/** The headless Variable values: none. */
export const variableValues: VariableValues.Shape = {
  isValue: () => false,
  values: () => NO_VARIABLES,
}

/** The headless ports, as `testLayer` gives them. */
export const layer: Layer.Layer<OwnValues.OwnValues | MeasuredPairs.MeasuredPairs | VariableValues.VariableValues> = Layer.mergeAll(
  Layer.succeed(OwnValues.OwnValues)(ownValues),
  Layer.succeed(MeasuredPairs.MeasuredPairs)(measuredPairs),
  Layer.succeed(VariableValues.VariableValues)(variableValues),
)
