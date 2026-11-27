/**
 * The DOM's reads of its elements' values, as core's ports take them: their own values
 * (`ownValues`), read through `@wardic/dom/OwnValues` and `Style`, and their Measured pairs
 * (`measuredPairs`), through `@wardic/dom/MeasuredPair`, and their Variable values (`variableValues`),
 * through `@wardic/dom/Variables`. A DOM binding's element code falls back to them when its
 * Environment gives none, so only an app that animates an element ships them; `layer` gives them to
 * an Environment that wants them explicit.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR2-Q2): the DOM's implementation of core's ports, one module,
// over dom's Tier 2 modules, which stay as they are.
import * as MeasuredPairs from "@wardic/core/unstable/MeasuredPairs"
import * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as VariableValues from "@wardic/core/unstable/VariableValues"
import * as Layer from "effect/Layer"
import * as Rec from "effect/Record"
import { measure, measured, needs, type Requested } from "../internal/measured-pairs.ts"
import { styleValueOf, valueLike } from "../internal/own-values.ts"
import { over } from "../internal/starting-style.ts"
import { isVariableValue, variableValues as variableRuleOf } from "../internal/variables.ts"

/** The DOM's own values: a raw value in a target's shape, a key's value in a `style` (CSS text parsed), a `style` as a record. */
export const ownValues: OwnValues.Shape = {
  valueLike,
  styleValueOf,
  recordOf: (style) => over(style, undefined),
}

/** A pair `measure` asked, with the read of its result: dom's `MeasuredPair.measured`. */
// Per Measured pair (#430): one object a pair, a key whose ends' units don't blend.
const withRead = (pair: Requested): MeasuredPairs.Requested => ({ ...pair, measured: () => measured(pair) })

/** The DOM's Measured pairs: a pair whose units don't blend, measured on its element at the end of the task. */
export const measuredPairs: MeasuredPairs.Shape = {
  needs,
  measure: (subject, pairs, values, failed) => Rec.map(measure(subject as HTMLElement, pairs, values, failed), withRead),
}

/** The DOM's Variable values: a `var(--x)`, resolved on its element as each leg starts. */
export const variableValues: VariableValues.Shape = {
  isValue: isVariableValue,
  values: (subject) => variableRuleOf(subject as Element),
}

/** The DOM's ports, for an Environment that gives them explicitly: `DomLive` doesn't (PR2-Q4). */
export const layer: Layer.Layer<OwnValues.OwnValues | MeasuredPairs.MeasuredPairs | VariableValues.VariableValues> = Layer.mergeAll(
  Layer.succeed(OwnValues.OwnValues)(ownValues),
  Layer.succeed(MeasuredPairs.MeasuredPairs)(measuredPairs),
  Layer.succeed(VariableValues.VariableValues)(variableValues),
)
