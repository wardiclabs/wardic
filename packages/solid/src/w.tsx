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
import { runDirective } from "./directive.ts"
import { type Create, createOf, formOf, type WardicComponent } from "./element.tsx"
import type { InferredMotion, TargetKey } from "./ward-keys.ts"

/** What a Slim element tells the spine: it brings no Feature of its own. */
const SLIM: SpineInternals = {}

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

/** The typed `w` proxy: called, it's the `use:w` directive; `w.create`, `w.createWard` and `w.<tag>` are its forms. */
export type W = ((el: HTMLElement, value: Accessor<WardConfig>) => void) & {
  readonly create: Create
  readonly createWard: typeof createSlimWard
} & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponent<Tag>
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
