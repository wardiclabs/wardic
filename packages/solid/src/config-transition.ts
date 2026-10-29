/**
 * The **Config transition** (#434, CONTEXT.md; Motion's `MotionConfig` `transition`), Solid-free: what
 * a `WardicConfig` gives the Wardic elements below it, on both bindings.
 *
 * - **An element's own when it gives none,** as Motion's `{ ...config, ...props }`: whatever reads
 *   the element's `transition` reads it, a Variant child's in place of its parent's (Q3).
 * - **A `WardicConfig` inside another** replaces its transition, or with `inherit: true` lays its own
 *   fields over it (Motion's `resolveTransition`); one that gives none passes its parent's on.
 *
 * @module
 */
import * as Predicate from "effect/Predicate"
import type { WardicTransition, WardicVariantTransition } from "./config.ts"
import { transitionOfTarget } from "./variant-target.ts"

/** What a `WardicConfig` gives below it (#434): one value per config, read where a binding reads it. */
export interface WardicConfigValue {
  /** Its **Config transition**: read when an element's transition is, so a change starts nothing by itself. */
  readonly transition: () => WardicTransition | undefined
}

/**
 * A `WardicConfig`'s transition (#434): its own, laid over its parent's with `inherit: true` (as a
 * variant's own is over the element's), else its parent's when it gives none.
 */
export const configTransitionOf = (own: WardicVariantTransition | undefined, parent: WardicConfigValue | undefined): WardicTransition | undefined =>
  transitionOfTarget(own, parentTransitionOf(parent))

const parentTransitionOf = (parent: WardicConfigValue | undefined): WardicTransition | undefined => {
  if (Predicate.isUndefined(parent)) return undefined
  return parent.transition()
}

/**
 * `c` with its **Config transition** as its own when it gives none (#434, Motion's spread): `c` as it
 * is when it has its own or the config gives none.
 */
export const withConfigTransition = <C extends { readonly transition?: WardicTransition | undefined }>(c: C, config: WardicConfigValue | undefined): C => {
  if (Predicate.isNotUndefined(c.transition)) return c
  if (Predicate.isUndefined(config)) return c
  const transition = config.transition()
  if (Predicate.isUndefined(transition)) return c
  return { ...c, transition }
}
