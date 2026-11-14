/**
 * `createWardic(features)` (#516, ADR-0067 *Amendment (#516)*): a **Wardic instance**, a `w` whose
 * elements bring `features` wherever they render, typed to their props alone, and the layout hooks.
 * In a module of its own that names no Feature: an app's instance module ships the Features it gives.
 *
 * @module
 */
import { type InstanceFeaturesProp } from "./feature.ts"
import { instanceFeaturesOf } from "./instance-features.ts"
import { createInstantLayoutTransition, createResetProjection, useAnimateLayout, useInstanceBrought } from "./provider.tsx"
import { wOf } from "./w.tsx"
import type { WardicInstance } from "./wardic-instance.ts"

/**
 * Makes a Wardic instance: a `w` whose elements bring `features` wherever they render and take their
 * props alone, so a prop of a Feature the list lacks is a type error that names it. Give each Feature
 * at once, or a load (`() => import(…)`), which starts the first time one of its elements or wards is
 * made, or a hook is called, on the client. With `layout`, it returns the layout hooks too, which bring
 * it. Call it once, in a module of its own. Motion has no counterpart; its nearest is `m` under
 * `LazyMotion`, whose Features its types don't follow.
 *
 * @example
 * // src/lib/wardic.ts
 * export const { w } = createWardic([domAnimation, layout])
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// #516: decisions 1 (beside the sections), 2 (its elements bring their Features), 4 (every form), 5 (the
// layout hooks), 7 (loads), 8 (`strict` allows them).
export function createWardic<const F extends InstanceFeaturesProp>(features: F): WardicInstance<F> {
  const instance = instanceFeaturesOf(features)
  /** `hook`, its instance's Features brought first. */
  const bringing =
    <A,>(hook: () => A) =>
    (): A => {
      useInstanceBrought(instance)
      return hook()
    }
  // The layout hooks are there at runtime whatever its Features: its type shows them only with `layout`.
  return {
    w: wOf({ instance }),
    useAnimateLayout: bringing(useAnimateLayout),
    createInstantLayoutTransition: bringing(createInstantLayoutTransition),
    createResetProjection: bringing(createResetProjection),
  } as unknown as WardicInstance<F>
}
