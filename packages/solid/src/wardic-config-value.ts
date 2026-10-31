/**
 * What a `WardicConfig` gives the Wardic elements below it (#434, Motion's `MotionConfig`),
 * Solid-free, on both bindings: its **Config transition**, its reduced motion and whether its
 * animations are skipped (#468).
 *
 * - **The Config transition is an element's own when it gives none,** as Motion's
 *   `{ ...config, ...props }`: whatever reads the element's `transition` reads it, a Variant child's in
 *   place of its parent's (Q3).
 * - **Its reduced motion** (ADR-0029) is the element's, over the `WardicProvider`'s (Q2), as Motion
 *   reads its `MotionConfig`'s per element.
 * - **`skipAnimations`** (#468) makes every animation of the elements below a **Skipped animation**,
 *   Motion's `MotionConfig` `skipAnimations`, whatever their reduced motion.
 * - **`isValidProp`** (#443) keeps a tag's props it says aren't valid off its element, Motion's
 *   `MotionConfig` `isValidProp`.
 * - **A `WardicConfig` inside another** replaces its transition, or with `inherit: true` lays its own
 *   fields over it (Motion's `resolveTransition`); one that gives none passes its parent's on, as one
 *   that gives no reduced motion, `skipAnimations` or `isValidProp` passes its parent's.
 *
 * @module
 */
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import { constFalse } from "effect/Function"
import * as Predicate from "effect/Predicate"
import type { WardicTransition, WardicVariantTransition } from "./config.ts"
import { transitionOfTarget } from "./variant-target.ts"

/** What a `WardicConfig` gives below it (#434): one value per config, read where a binding reads it. */
export interface WardicConfigValue {
  /** Its **Config transition**: read when an element's transition is, so a change starts nothing by itself. */
  readonly transition: () => WardicTransition | undefined
  /**
   * Its reduced motion (ADR-0029): its own, else an enclosing config's, else `undefined` for the
   * `WardicProvider`'s. Read when each animation starts.
   */
  readonly reducedMotion: () => ReducedMotion.Config | undefined
  /**
   * Whether its animations are skipped (#468): its own, else an enclosing config's, else `undefined`,
   * as `false`. Read when each animation starts.
   */
  readonly skipAnimations: () => boolean | undefined
  /**
   * Which of a tag's own props reach its element (#443, Motion's `MotionConfig` `isValidProp`): its
   * own, else an enclosing config's, else `undefined`, every one. Read as each element is made.
   */
  readonly isValidProp: () => ((key: string) => boolean) | undefined
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

/** A `WardicConfig`'s reduced motion (#434): its own, else its parent's, else none (the provider's). */
export const configReducedMotionOf = (own: ReducedMotion.Config | undefined, parent: WardicConfigValue | undefined): ReducedMotion.Config | undefined => {
  if (Predicate.isNotUndefined(own)) return own
  if (Predicate.isUndefined(parent)) return undefined
  return parent.reducedMotion()
}

/** A `WardicConfig`'s `skipAnimations` (#468): its own, else its parent's, else none. */
export const configSkipAnimationsOf = (own: boolean | undefined, parent: WardicConfigValue | undefined): boolean | undefined => {
  if (Predicate.isNotUndefined(own)) return own
  if (Predicate.isUndefined(parent)) return undefined
  return parent.skipAnimations()
}

/** A `WardicConfig`'s `isValidProp` (#443): its own, else its parent's, else none. */
export const configIsValidPropOf = (own: ((key: string) => boolean) | undefined, parent: WardicConfigValue | undefined): ((key: string) => boolean) | undefined => {
  if (Predicate.isNotUndefined(own)) return own
  if (Predicate.isUndefined(parent)) return undefined
  return parent.isValidProp()
}

/** The nearest config's `isValidProp` (#443), as an element is made: `undefined` for none. */
export const isValidPropOf = (config: WardicConfigValue | undefined): ((key: string) => boolean) | undefined => {
  if (Predicate.isUndefined(config)) return undefined
  return config.isValidProp()
}

/**
 * Whether an element's animations are skipped (#468), read when each starts: its nearest config's
 * `skipAnimations`. With no config above, never, and nothing made.
 */
export const skipAnimationsOf = (config: WardicConfigValue | undefined): (() => boolean) => {
  if (Predicate.isUndefined(config)) return constFalse
  return () => config.skipAnimations() === true
}

/** The reduced motion an element's nearest config sets (#434), now: `undefined` for none, the provider's. */
export const settingOf = (config: WardicConfigValue | undefined): ReducedMotion.Config | undefined => {
  if (Predicate.isUndefined(config)) return undefined
  return config.reducedMotion()
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
