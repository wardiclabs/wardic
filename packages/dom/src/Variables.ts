/**
 * CSS variables in animated values: a value that's wholly a `var()` is resolved against an element, so
 * `var(--accent)` animates from or to the colour it stands for. `values` is the Key rule a binding adds
 * for an element's own animations.
 *
 * @example
 * import * as Variables from "@wardic/dom/Variables"
 *
 * Variables.isValue("var(--gap)") // true
 * Variables.resolve(element, "var(--gap)") // what `--gap` computes to on `element`
 */
// `@wardic/dom/Variables` (#132, ADR-0041): #55, ADR-0035.
export {
  isVariableValue as isValue,
  resolveVariable as resolve,
  variableValues as values,
} from "./internal/variables.ts"
