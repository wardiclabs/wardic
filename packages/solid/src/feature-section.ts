/**
 * A section's **Features** (#511, ADR-0067), for the Solid 1 binding: the context each `LazyWardic`
 * puts its section in (`feature.ts`'s `makeSection`), so a Slim element has its provider's Features
 * and every `LazyWardic`'s between them (decision 2). A provider's own section isn't in it: the
 * provider keeps it (`provider.tsx`), so a provider renders no second context, and every hydration
 * key stays where it was.
 *
 * @module
 */
import type * as Cause from "effect/Cause"
import { createContext, onCleanup, useContext } from "solid-js"
import { type FeatureRegistry, type FeatureSection, type FeaturesProp, makeSection, type SectionHost } from "./feature.ts"
import { isServer } from "./server.ts"
import { reactivity } from "./solid-reactivity.ts"

const FeatureSectionContext = createContext<FeatureSection | undefined>(undefined)

/** The nearest `LazyWardic`'s section, or `undefined` under none: its provider's then. */
export const useLazySection = (): FeatureSection | undefined => useContext(FeatureSectionContext)

/** The Provider a `LazyWardic`'s subtree renders under. */
export const FeatureSectionProvider = FeatureSectionContext.Provider

const HOST: SectionHost = { reactivity, server: isServer, onCleanup }

/** A section under `parent`, made under the current owner (`feature.ts`'s `makeSection`). */
export const sectionUnder = (
  parent: FeatureSection,
  registry: FeatureRegistry,
  prop: FeaturesProp | undefined,
  strict: boolean,
  report: (cause: Cause.Cause<unknown>) => void,
): FeatureSection => makeSection(parent, registry, prop, strict, report, HOST)
