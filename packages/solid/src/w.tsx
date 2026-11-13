/**
 * `w` — the **Slim element**'s forms (#511, ADR-0067 decision 6; Motion's `m`): `w.<tag>`,
 * `w.create(tag | Component)`, `w.createWard(config)` and the `use:w` directive, each as its
 * `wardic` form is. A Slim element animates values (`initial`, `animate`, `exit`, variants,
 * transitions, Keyframes), with the **Features** chosen above it: its `WardicProvider`'s and every
 * `LazyWardic`'s between them. This module names no Feature, so an app of Slim elements ships only
 * those it chooses.
 *
 * ```tsx
 * <WardicProvider env={DomLive} features={[colors]}>
 *   <w.div animate={{ color: "oklch(0.7 0.1 200)" }} />
 * </WardicProvider>
 * ```
 *
 * @module
 */
import type { Accessor, JSX } from "solid-js"
import type { WardConfig, WardFeatureConfigs, WardicVariantLabels } from "./config.ts"
import { createWardWith, type SpineInternals, type Ward } from "./create-ward.tsx"
import { runDirective } from "./directive.tsx"
import { createOf, type CreateWith, type EveryFeature, formOf, type PropNames, type WardConfigWith, type WardicComponentWith } from "./element.tsx"
import type { AbsentGroupsOf, NamesEvery } from "./feature.ts"
import type { InferredMotion, InferredMotionOf, TargetKey } from "./ward-keys.ts"

/** What a Slim element tells the spine: it brings no Feature of its own. */
const SLIM: SpineInternals = {}

/**
 * A Wardic instance's `w.createWard` (#516), its Features named `FN`: `createSlimWard`, its config typed
 * to their props alone, every other Feature's `NeedsFeature<"name">`. With every one, `createSlimWard`.
 */
type CreateWardWith<FN extends string> =
  NamesEvery<WardFeatureConfigs, FN> extends true
    ? typeof createSlimWard
    : <
        K extends TargetKey = never,
        N extends string = never,
        LI extends WardicVariantLabels = never,
        LA extends WardicVariantLabels = never,
        D extends boolean | "x" | "y" = never,
      >(
        config: InstanceConfig<FN, K, N, LI, LA, D> | Accessor<InstanceConfig<FN, K, N, LI, LA, D>>,
      ) => Ward

/** A Wardic instance's ward config, its Features named `FN`, keys inferred (#305). */
type InstanceConfig<FN extends string, K extends TargetKey, N extends string, LI extends WardicVariantLabels, LA extends WardicVariantLabels, D extends boolean | "x" | "y"> =
  InferredMotionOf<WardConfigWith<FN>, K, N, LI, LA, D> & AbsentGroupsOf<WardFeatureConfigs, FN>

/** The `use:w` directive. An arrow function, as `use:wardic`'s is. */
const wDirective = (el: HTMLElement, value: Accessor<WardConfig>): void => runDirective(el, value, SLIM)

/** `w.createWard(config)`: `createWard`'s Ward on a Slim element. */
function createSlimWard<
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(config: InferredMotion<WardConfig, K, N, LI, LA, D> | Accessor<InferredMotion<WardConfig, K, N, LI, LA, D>>): Ward {
  return createWardWith(config as WardConfig | Accessor<WardConfig>, SLIM)
}

/**
 * The typed `w` proxy: called, it's the `use:w` directive; `w.create`, `w.createWard` and `w.<tag>` are
 * its forms. `F` (#516): a Wardic instance's Features, every one unless it's an instance's. `use:w` is
 * typed by Solid's global `JSX.Directives`, by its name, so it takes every prop whatever `F` is.
 */
export type W<F = EveryFeature> = WWith<PropNames<F>>

/** {@link W} for the Features named `FN` (#516). */
type WWith<FN extends string> = ((el: HTMLElement, value: Accessor<WardConfig>) => void) & {
  readonly create: CreateWith<FN>
  readonly createWard: CreateWardWith<FN>
} & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponentWith<Tag, FN>
}

/**
 * The Slim element: `w.div`, `w.button` and every other tag, each taking the element's own props and
 * Wardic's motion props. It has the Features its `WardicProvider` and any `LazyWardic` above it give.
 * `w.create(Component)` makes your own component one, `w.createWard(config)` a ward for an element of
 * your own, and `use:w={config}` the same as a directive. Motion's `m.div`.
 *
 * @example <w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
 * @see https://wardic.dev/reference/solid/elements/w
 */
// Every form of the Slim element, as `wardic`'s are of the Complete one (ADR-0067).
export const w: W = formOf<W>(wDirective, createOf(SLIM), { createWard: createSlimWard })
