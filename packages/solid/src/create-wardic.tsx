/**
 * `createWardic(features)` (#516, ADR-0067 *Amendment (#516)*): a **Wardic instance**, a `w` whose
 * elements bring `features` wherever they render, typed to their props alone, and the layout hooks.
 * In a module of its own that names no Feature: an app's instance module ships the Features it gives.
 *
 * @module
 */
import type { Accessor } from "solid-js"
import type { WardConfig } from "./config.ts"
import { createWardWith, type SpineInternals, type Ward } from "./create-ward.tsx"
import { runDirective } from "./directive.tsx"
import { createOf, formOf } from "./element.tsx"
import { type InstanceFeaturesProp, instanceFeaturesOf } from "./feature.ts"
import { createInstantLayoutTransition, createResetProjection, useAnimateLayout } from "./provider.tsx"
import type { W } from "./w.tsx"
import type { WardicInstance } from "./wardic-instance.ts"

/**
 * Makes a Wardic instance: a `w` whose elements bring `features` wherever they render and take their
 * props alone, so a prop of a Feature the list lacks is a type error that names it. Give each Feature
 * at once, or a load (`() => import(…)`), which starts the first time one of its elements mounts.
 * With `layout`, it returns the layout hooks too, which bring it. Call it once, in a module of its own.
 *
 * @example
 * // src/lib/wardic.ts
 * export const { w } = createWardic([domAnimation, layout])
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// #516: decisions 1 (beside the sections), 2 (its elements bring their Features), 4 (every form), 5 (the
// layout hooks), 7 (loads), 8 (`strict` allows them).
export function createWardic<const F extends InstanceFeaturesProp>(features: F): WardicInstance<F> {
  const kind: SpineInternals = { instance: instanceFeaturesOf(features) }
  const directive = (el: HTMLElement, value: Accessor<WardConfig>): void => runDirective(el, value, kind)
  const createWard = (config: WardConfig | Accessor<WardConfig>): Ward => createWardWith(config, kind)
  return {
    w: formOf<W>(directive, createOf(kind), { createWard }),
    useAnimateLayout: () => useAnimateLayout(),
    createInstantLayoutTransition: () => createInstantLayoutTransition(),
    createResetProjection: () => createResetProjection(),
  } as unknown as WardicInstance<F>
}
