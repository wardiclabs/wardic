/**
 * The DOM's edges of the Flush gate (#672): an element's own inline value for a patch key, and the
 * key the DOM's renderer reserves for an element's Transform template. `FlushGate.make` gives them to
 * the gate it builds.
 */
// #672 (PR2-Q1): out of `gate.ts`, so the gate reads no DOM and moves to core as it is.
import * as Predicate from "effect/Predicate"
import type { GateEnvironment } from "./gate.ts"
import { TEMPLATE_KEY } from "./renderer.ts"
import { dashCase } from "./svg.ts"

/** The element's inline value for a patch key, before the gate writes it (`""` for none, or a target with no style). */
const valueBeforeOf = (target: unknown, key: string): string => {
  if (Predicate.isNullish(target)) return ""
  const style = (target as { readonly style?: CSSStyleDeclaration }).style
  if (Predicate.isUndefined(style)) return ""
  return style.getPropertyValue(dashCase(key))
}

/** The DOM's: its inline style, and its renderer's Transform template key. */
export const DOM_GATE: GateEnvironment = { valueBeforeOf, templateKey: TEMPLATE_KEY }
