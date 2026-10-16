/**
 * CSS variables: a `var()` value, resolved against an element (#55, ADR-0035).
 *
 * `@wardic/dom/Variables` (#132, ADR-0041).
 */
export {
  isVariableValue as isValue,
  resolveVariable as resolve,
  variableValues as values,
} from "./internal/variables.ts"
