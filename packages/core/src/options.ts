/**
 * Shared value types for the engine. The Primitives' option bags (`TweenOptions`,
 * `SpringOptions`, `DecayOptions`, `AnimateOptions`, `Modifiers`) live in the `Machine` module,
 * beside the constructors that take them (ADR-0028).
 */

/** Easing function mapping normalized time `t` in [0, 1] to eased progress. */
export type Easing = (t: number) => number

/** A flat bag of animatable values (numbers or unit/color strings). */
export type Values = Record<string, number | string>

/** A named animation state. */
export type Variant = Record<string, number | string>

/** A map of variant name → values, propagated through the component tree. */
export type Variants = Record<string, Variant>
