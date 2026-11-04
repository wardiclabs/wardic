/**
 * `w` on Solid 2 — the **Slim element**'s forms (#511, ADR-0067 decision 6; Motion's `m`): `w.<tag>`,
 * `w.create(tag | Component)` and `w.ward(config)`, each as its Complete form (`wardic.<tag>`,
 * `wardic.create`, `ward()`) is. A Slim element animates values (`initial`, `animate`, `exit`,
 * variants, transitions, Keyframes), with the **Features** chosen above it: its `WardicProvider`'s and
 * every `LazyWardic`'s between them. This module names no Feature, so an app of Slim elements ships
 * only those it chooses.
 *
 * ```tsx
 * <WardicProvider env={DomLive} features={[colors]}>
 *   <w.div animate={{ color: "oklch(0.7 0.1 200)" }} />
 * </WardicProvider>
 * ```
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import * as Predicate from "effect/Predicate"
import { type Create, createOf, formOf, type WardicComponent } from "./element.tsx"
import { internalsOf, SLIM, type Ward, type WardChecked, type WardConfig, wardWith, type WardOptions } from "./ward.tsx"

/** `w.ward(config, options)`: `ward()`'s ward, on a Slim element. */
function slimWard<const C extends WardConfig>(config: WardChecked<C>, options?: WardOptions): Ward<C>
function slimWard(): Ward<{}>
function slimWard(config: undefined, options: WardOptions): Ward<{}>
function slimWard(config?: WardConfig, options?: WardOptions): Ward {
  if (Predicate.isUndefined(config)) return wardWith(NO_CONFIG, internalsOf(options, SLIM))
  return wardWith(config, internalsOf(options, SLIM))
}

/** No config: a ward that only listens (#398), `w.ward()`. */
const NO_CONFIG: WardConfig = {}

/** `w`: `w.create`, `w.ward`, and `w.<tag>`, a Slim element's component for that element (one per tag). */
export type W = { readonly create: Create; readonly ward: typeof slimWard } & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponent<Tag>
}

/**
 * The Slim element: `w.div`, `w.button` and every other tag, each taking the element's own props and
 * Wardic's motion props. It has the Features its `WardicProvider` and any `LazyWardic` above it give.
 * `w.create(Component)` makes your own component one, and `w.ward(config)` a ward for an element of
 * your own. Motion's `m.div`.
 *
 * @example <w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
 * @see https://wardic.dev/reference/solid/elements/w
 */
// Every form of the Slim element, as `wardic`'s and `ward()` are of the Complete one (ADR-0067).
export const w: W = formOf<W>(createOf(SLIM), { ward: slimWard })
