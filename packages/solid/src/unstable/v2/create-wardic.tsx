/**
 * `createWardic(features)` on Solid 2 (#516, ADR-0067 *Amendment (#516)*): a **Wardic instance**, a `w`
 * whose elements and wards bring `features` wherever they render, typed to their props and events
 * alone, and the layout hooks. In a module of its own that names no Feature: an app's instance module
 * ships the Features it gives.
 *
 * @module
 */
import * as Predicate from "effect/Predicate"
import { type InstanceFeaturesProp, instanceFeaturesOf } from "../../feature.ts"
import { createOf, formOf } from "./element.tsx"
import { createInstantLayoutTransition, createResetProjection, useAnimateLayout } from "./provider.tsx"
import { internalsOf, type Ward, type WardConfig, type WardInternals, wardWith, type WardOptions } from "./ward.tsx"
import type { W } from "./w.tsx"
import type { WardicInstance } from "./wardic-instance.ts"

/** No config: a ward that only listens (#398). */
const NO_CONFIG: WardConfig = {}

/**
 * Makes a Wardic instance: a `w` whose elements bring `features` wherever they render and take their
 * props alone, so a prop of a Feature the list lacks is a type error that names it, as listening for
 * its event on a ward is. Give each Feature at once, or a load (`() => import(…)`), which starts the
 * first time one of its elements mounts. With `layout`, it returns the layout hooks too, which bring
 * it. Call it once, in a module of its own.
 *
 * @example
 * // src/lib/wardic.ts
 * export const { w } = createWardic([domAnimation, layout])
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// #516: decisions 1 (beside the sections), 2 (its elements bring their Features), 4 (every form), 5 (the
// layout hooks), 7 (loads), 8 (`strict` allows them), 10 (the events, Q19).
export function createWardic<const F extends InstanceFeaturesProp>(features: F): WardicInstance<F> {
  const kind: WardInternals = { instance: instanceFeaturesOf(features) }
  const ward = (config?: WardConfig, options?: WardOptions): Ward => {
    if (Predicate.isUndefined(config)) return wardWith(NO_CONFIG, internalsOf(options, kind))
    return wardWith(config, internalsOf(options, kind))
  }
  return {
    w: formOf<W>(createOf(kind), { ward }),
    useAnimateLayout: () => useAnimateLayout(),
    createInstantLayoutTransition: () => createInstantLayoutTransition(),
    createResetProjection: () => createResetProjection(),
  } as unknown as WardicInstance<F>
}
