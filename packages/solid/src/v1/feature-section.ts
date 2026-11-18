/**
 * A section's **Features** (#511, ADR-0067), for the Solid 1 binding: the context each `LazyWardic`
 * puts its section in (dom's `Feature.makeSection`), so a Slim element has its provider's Features
 * and every `LazyWardic`'s between them (decision 2). A provider's own section isn't in it: the
 * provider keeps it (`provider.tsx`), so a provider renders no second context, and every hydration
 * key stays where it was.
 *
 * @module
 */
import type * as Cause from "effect/Cause"
import { createContext, onCleanup, useContext } from "solid-js"
import * as Feature from "@wardic/dom/unstable/Feature"
import { isServer } from "./server.ts"
import { reactivity } from "./solid-reactivity.ts"

const FeatureSectionContext = createContext<Feature.FeatureSection | undefined>(undefined)

/** The nearest `LazyWardic`'s section, or `undefined` under none: its provider's then. */
export const useLazySection = (): Feature.FeatureSection | undefined => useContext(FeatureSectionContext)

/** The Provider a `LazyWardic`'s subtree renders under. */
export const FeatureSectionProvider = FeatureSectionContext.Provider

const HOST: Feature.SectionHost = { reactivity, server: isServer, onCleanup }

/** A section under `parent`, made under the current owner (dom's `Feature.makeSection`). */
export const sectionUnder = (
  parent: Feature.FeatureSection,
  registry: Feature.FeatureRegistry,
  prop: Feature.FeaturesProp | undefined,
  strict: boolean,
  report: (cause: Cause.Cause<unknown>) => void,
): Feature.FeatureSection => Feature.makeSection(parent, registry, prop, strict, report, HOST)
