/**
 * `stagger()` (#436, Motion's): a child's delay from its index and the count, for a transition's
 * `delayChildren` or `createAnimate`'s `delay`. Solid-free, on both bindings.
 *
 * @module
 */
import type * as Easing from "@wardic/core/Easing"
import * as Stagger from "@wardic/core/Stagger"
import type { WardicStagger } from "./config.ts"

/** `stagger()`'s options (Motion's `StaggerOptions`). */
export interface WardicStaggerOptions {
  /** Seconds before the first child's delay. Default 0. */
  readonly startDelay?: number
  /** The child the delay grows from: `"first"`, `"last"`, `"center"` or an index. Default the first. */
  readonly from?: Stagger.Origin
  /** How the delay grows across the children, eased across `duration × count`, as Motion's. Default linear. */
  readonly ease?: Easing.Definition
}

/**
 * A stagger, Motion's `stagger()`: each child waits `startDelay` plus `duration` for each step from
 * `from`, eased by `ease`. Give it as a transition's `delayChildren`, where it decides each Variant
 * child's whole delay, or as `createAnimate`'s `delay`.
 *
 * ```tsx
 * <wardic.ul animate="shown" variants={list} transition={{ delayChildren: stagger(0.05, { from: "center" }) }}>
 * ```
 */
export const stagger = (duration = 0.1, options: WardicStaggerOptions = {}): WardicStagger => Stagger.make(duration, options)
