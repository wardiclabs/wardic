/**
 * A `class` from a base class and conditional ones: what `classList` did, which Solid 2 dropped
 * (its `class` takes an object instead), as a string both Solids take, so the UI compiles on either
 * (#209 PR 5).
 *
 * @module
 */
export const classOf = (base: string, conditional: Readonly<Record<string, boolean>>): string =>
  [base, ...Object.keys(conditional).filter((name) => conditional[name] === true)].filter((name) => name !== "").join(" ")
