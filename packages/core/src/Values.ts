/**
 * The `Values` module: a flat bag of animatable values, and the variants a component tree
 * names (CONTEXT.md's Variant). Plain shapes callers write, so no prototype (ADR-0028,
 * decision 1); their operations come with #97.
 */

/** A flat bag of animatable values (numbers or unit/color strings). */
export type Values = Record<string, number | string>

/** A named animation state. */
export type Variant = Record<string, number | string>

/** A map of variant name → values, propagated through the component tree. */
export type Variants = Record<string, Variant>
