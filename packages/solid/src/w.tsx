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
import type { WardConfig, WardicVariantLabels } from "./config.ts"
import { createWardWith, type SpineInternals, type Ward } from "./create-ward.tsx"
import { runDirective } from "./directive.tsx"
import { createOf, type CreateFor, formOf, type InferredPropsFor, type WardicComponentFor } from "./element.tsx"
import type { EveryFeature, PropFeatureNames } from "./feature.ts"
import type { TargetKey } from "./ward-keys.ts"

/** What a Slim element tells the spine: it brings no Feature of its own. */
const SLIM: SpineInternals = {}

/** A Wardic instance's `w.createWard` (#516), its Features named `FN`: its config typed to their props alone. */
type CreateWardFor<FN extends string> = <
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(
  config: InferredPropsFor<FN, K, N, LI, LA, D> | Accessor<InferredPropsFor<FN, K, N, LI, LA, D>>,
) => Ward

/**
 * Every form of a `w` whose elements are of `kind` (#516): the Slim element's `w`, and a Wardic
 * instance's. Its directive is an arrow function, as `use:wardic`'s is.
 */
export const wOf = (kind: SpineInternals): W =>
  formOf<W>((el: HTMLElement, value: Accessor<WardConfig>): void => runDirective(el, value, kind), createOf(kind), {
    createWard: (config: WardConfig | Accessor<WardConfig>): Ward => createWardWith(config, kind),
  })

/**
 * The type of `w`: called, it's the `use:w` directive; `w.create`, `w.createWard` and `w.<tag>` are its
 * forms. `W<F>` is a Wardic instance's `w`, whose elements take only Features `F`'s props; its `use:w`
 * takes every prop all the same, as Solid types a directive by its name.
 *
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// `F`: #516, ADR-0067 *Amendment (#516)*; `use:w`, its decision 4.
export type W<F = EveryFeature> = WFor<PropFeatureNames<F>>

/** {@link W} for the Features named `FN` (#516). */
type WFor<FN extends string> = ((el: HTMLElement, value: Accessor<WardConfig>) => void) & {
  readonly create: CreateFor<FN>
  readonly createWard: CreateWardFor<FN>
} & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponentFor<Tag, FN>
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
export const w: W = wOf(SLIM)
