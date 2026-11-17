/**
 * Layout on Foldkit (ADR-0071 decision 30; *Amendment (#791)* at slice 2): a provider's `layout`
 * Feature, built at the first layout element's mount, and what triggers its Measure passes. Under the
 * default trigger (`"patch"`) one `MutationObserver` watches the subtree of the `w.Provider()` element,
 * else the document's body, for the child list, the text, and the `class` and `hidden` attributes with
 * the app's `layoutAttributes`; each delivery, a microtask after Foldkit's patch, gives the Frame loop
 * the hint and asks the projection system for one pass, so every layout element moved by the patch
 * animates from where it was (P13). Under `"declared"` there is no observer: a `w.LayoutDependency`
 * change and `Wardic.animateLayout` ask for the passes.
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Feature from "@wardic/dom/unstable/Feature"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { hintFrame } from "./delivery.ts"
import { type Provider, type State } from "./services.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** A provider's layout: its projection system, the `layout` Feature's element code, and its observer under `"patch"`. */
export interface Layout {
  readonly projection: ProjectionSystem.Shape
  readonly nodes: Keys.ProjectionNodes["Service"]
  /** Drop the records the observer holds now: a presence told not to affect layout drops its own moves (#792, Q21). */
  readonly dropRecords: () => void
}

// Module state (#460, Q7): each provider's layout, held weakly by the provider, made at the first layout element's mount.
const layouts = new WeakMap<Provider, Layout>()

/** What the observer watches beside the app's `layoutAttributes` (decision 30, R9 Q40): what CSS lays out by, not `style`, which the passes write. */
const WATCHED = ["class", "hidden"]

/**
 * `provider`'s layout, its `layout` Feature built now if nothing has built it (#511): what a layout
 * element makes its node on. `undefined` when the Handle wasn't given the Feature, warned once in
 * development, as Solid 2's element warns.
 */
export const layoutOf = (provider: Provider, state: State): Layout | undefined => {
  const known = layouts.get(provider)
  if (Predicate.isNotUndefined(known)) return known
  const built = provider.registry.build(state.given)
  const projection = Keys.projectionIn(built)
  if (Predicate.isUndefined(projection)) {
    if (DEV) provider.registry.warnOnce("layout", Feature.missingMessage("layout", Feature.LAYOUT_PROPS, "@wardic/foldkit"))
    return undefined
  }
  const made: Layout = { projection, nodes: Keys.projectionNodesIn(built), dropRecords: observing(provider, state, projection) }
  layouts.set(provider, made)
  return made
}

/**
 * The observer under `"patch"` (decision 30): on the `w.Provider()` element when one is mounted as the
 * layout is made, else the document's body (#792, Q17; the DevTools overlay's mutations under the body
 * are a development-only cost, Q24), disconnected as the provider ends. Returns what drops its records;
 * under `"declared"`, nothing watches and nothing is dropped.
 */
const observing = (provider: Provider, state: State, projection: ProjectionSystem.Shape): (() => void) => {
  if (state.layout.trigger === "declared") return () => {}
  const observer = new MutationObserver(() => {
    // The pass's first step paints in the patch's frame (decision 32; #792, Q7), unless replay has a view (decision 34).
    if (Bool.not(provider.paused())) hintFrame(provider.loop)
    projection.notify()
  })
  const root = UndefinedOr.match(provider.root, { onUndefined: () => document.body, onDefined: (element): Node => element })
  observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: [...WATCHED, ...UndefinedOr.match(state.layout.attributes, { onUndefined: () => [], onDefined: (given) => given })] })
  provider.registry.onEnd(() => observer.disconnect())
  return () => {
    observer.takeRecords()
  }
}

/** The layout `provider` has made, if any: what a presence drops its records on (#792, Q21), without building the Feature. */
export const dropLayoutRecords = (provider: Provider): void => {
  UndefinedOr.map(layouts.get(provider), (layout) => layout.dropRecords())
}
