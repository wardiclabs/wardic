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
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { hintFrame } from "./delivery.ts"
import { type Provider, type State } from "./services.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** A provider's layout: its projection system, and the `layout` Feature's element code. */
export interface Layout {
  readonly projection: ProjectionSystem.Shape
  readonly nodes: Keys.ProjectionNodes["Service"]
}

// Module state (#460, Q7): each provider's layout, held weakly by the provider, made at the first layout element's mount.
const layouts = new WeakMap<Provider, Layout>()

// Module state (#460, Q7): the presence elements told not to affect layout (Motion's `presenceAffectsLayout: false`),
// held weakly: a change of their child list, the presence's own moves and Foldkit's among them, makes no pass (#792, Q21).
const quiet = new WeakSet<Element>()

/** What the observer watches beside the app's `layoutAttributes` (decision 30, R9 Q40): what CSS lays out by, not `style`, which the passes write. */
const WATCHED: ReadonlyArray<string> = ["class", "hidden"]

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
  const made: Layout = { projection, nodes: Keys.projectionNodesIn(built) }
  layouts.set(provider, made)
  // The observer, a microtask later: Foldkit mounts a child before its parent, so a `w.Provider()` root
  // mounting in this patch, after its first layout element, is known by then (#792, Q17).
  if (state.layout.trigger !== "declared") queueMicrotask(() => observe(provider, state, projection))
  return made
}

/** Whether `element`'s child list's changes make a pass: `false` for a presence told not to affect layout, read at each of its deliveries. */
export const quietLayoutIn = (element: Element, isQuiet: boolean): void => {
  Bool.match(isQuiet, { onTrue: () => quiet.add(element), onFalse: () => quiet.delete(element) })
}

/** A record of a quiet presence's child list: the presence's own moves, or Foldkit's children going and coming under it. */
const isQuietChange = (record: MutationRecord): boolean => Bool.and(record.type === "childList", Bool.and(record.target instanceof Element, quiet.has(record.target as Element)))

/**
 * The observer under `"patch"` (decision 30): on the `w.Provider()` element when one is mounted as it's
 * made, else the document's body (#792, Q17; the DevTools overlay's mutations under the body are a
 * development-only cost, Q24), disconnected as the provider ends, with its Feature registry. A delivery
 * of quiet changes alone asks for nothing.
 */
const observe = (provider: Provider, state: State, projection: ProjectionSystem.Shape): void => {
  // The provider ended before this ran: nothing to watch.
  if (state.live !== provider) return
  const observer = new MutationObserver((records) => {
    if (Arr.every(records, isQuietChange)) return
    // The pass's first step paints in the patch's frame (decision 32; #792, Q7), unless replay has a view (decision 34).
    if (Bool.not(provider.paused())) hintFrame(provider.loop)
    projection.notify()
  })
  const root = UndefinedOr.match(provider.root, { onUndefined: (): Node => document.body, onDefined: identity })
  observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: [...WATCHED, ...UndefinedOr.match(state.layout.attributes, { onUndefined: (): ReadonlyArray<string> => [], onDefined: identity })] })
  provider.registry.onEnd(() => observer.disconnect())
}
