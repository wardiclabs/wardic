/**
 * The DOM's reads of its elements' values, as core's ports take them: their own values
 * (`ownValues`), read through `@wardic/dom/OwnValues` and `Style`. A DOM binding's element code falls
 * back to them when its Environment gives none, so only an app that animates an element ships them;
 * `layer` gives them to an Environment that wants them explicit.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR2-Q2): the DOM's implementation of core's ports, one module,
// over dom's Tier 2 modules, which stay as they are.
import * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as Layer from "effect/Layer"
import { styleValueOf, valueLike } from "../internal/own-values.ts"
import { over } from "../internal/starting-style.ts"

/** The DOM's own values: a raw value in a target's shape, a key's value in a `style` (CSS text parsed), a `style` as a record. */
export const ownValues: OwnValues.Shape = {
  valueLike,
  styleValueOf,
  recordOf: (style) => over(style, undefined),
}

/** The DOM's ports, for an Environment that gives them explicitly: `DomLive` doesn't (PR2-Q4). */
export const layer: Layer.Layer<OwnValues.OwnValues> = Layer.succeed(OwnValues.OwnValues)(ownValues)
