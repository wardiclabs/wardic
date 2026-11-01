/**
 * A section's **Features** (#511, ADR-0067), for the Solid 2 binding: the context each `LazyWardic`
 * puts its section in (`../../feature.ts`'s `makeSection`), as the Solid 1 binding's
 * (`../../feature-section.ts`); a provider keeps its own (`provider.tsx`). A context value is its own
 * provider in Solid 2.
 *
 * @module
 */
import { isServer } from "@solidjs/web"
import type * as Cause from "effect/Cause"
import { createContext, getOwner, onCleanup, useContext } from "solid-js"
import * as Option from "effect/Option"
import { type FeatureRegistry, type FeatureSection, type FeaturesProp, makeSection } from "../../feature.ts"
import { reactivityIn } from "./solid-reactivity.ts"

/**
 * A `LazyWardic`'s section, a provider of its own. `null` under none: Solid 2 takes an `undefined`
 * default for none, and its `useContext` then throws outside a provider.
 */
export const FeatureSectionContext = createContext<FeatureSection | null>(null)

/** The nearest `LazyWardic`'s section, or `undefined` under none: its provider's then. */
export const useLazySection = (): FeatureSection | undefined => Option.getOrUndefined(Option.fromNullishOr(useContext(FeatureSectionContext)))

/** A section under `parent`, made under the current owner (`makeSection`). */
export const sectionUnder = (
  parent: FeatureSection,
  registry: FeatureRegistry,
  prop: FeaturesProp | undefined,
  strict: boolean,
  report: (cause: Cause.Cause<unknown>) => void,
): FeatureSection => makeSection(parent, registry, prop, strict, report, { reactivity: reactivityIn(getOwner()), server: isServer, onCleanup })
