/**
 * The **Features** a Handle takes (#511, ADR-0067; ADR-0071 *Amendment (#516)*, and *Amendment (#791)*
 * at slices 2 and 3): `Wardic.make({ env, features: [Features.layout, Features.presence] })`, or a
 * preset, `features: Features.domAnimation`, or a load, `features: () => import("./features.ts").then((m) => m.domMax)`.
 * Without one, a `w.*` element is Slim: a gesture attribute is then a type error naming its Feature,
 * and at runtime warns once in development and does nothing. The DOM's Features are `@wardic/dom`'s;
 * `presence` is the binding's own, since `w.Presence` sits on the shared builder and dom's presence
 * controller would otherwise ship to every Foldkit app.
 *
 * @example
 * import { DomLive } from "@wardic/dom"
 * import { Features, Wardic } from "@wardic/foldkit"
 *
 * const wardic = Wardic.make({ env: DomLive, features: [Features.domAnimation, Features.presence] })
 *
 * @module
 */
import * as Feature from "@wardic/dom/unstable/Feature"
import * as PresenceController from "@wardic/dom/unstable/PresenceController"
import * as Layer from "effect/Layer"
import { PresenceMaker, type PresenceMakerShape } from "./internal/keys.ts"

export { layout } from "@wardic/dom/unstable/features/Layout"
export { hover } from "@wardic/dom/unstable/features/Hover"
export { press } from "@wardic/dom/unstable/features/Press"
export { focus } from "@wardic/dom/unstable/features/Focus"
export { inView } from "@wardic/dom/unstable/features/InView"
export { pan } from "@wardic/dom/unstable/features/Pan"
export { drag } from "@wardic/dom/unstable/features/Drag"
// #795 (the storefront's part 2): a container's scroll as Live values, which Solid's `createScroll` brings
// by itself; a Foldkit app names it here, and `LiveValue.scroll` under `Wardic.provide` finds it.
export { scroll } from "@wardic/dom/unstable/features/Scroll"
export { domAnimation } from "@wardic/dom/unstable/features/DomAnimation"
export { domMax } from "@wardic/dom/unstable/features/DomMax"

/**
 * Presence (ADR-0007; ADR-0071 decision 29): `w.Presence` on a parent keeps each child Foldkit removes
 * on the page while its `w.Exit` plays, in Motion's order, with `mode`, `custom`, `onExitComplete`,
 * `propagate` and the rest of Motion's `AnimatePresence` props.
 */
export const presence: Feature.Feature<PresenceMaker, PresenceMakerShape, "presence"> = {
  name: "presence",
  key: PresenceMaker,
  layer: /*#__PURE__*/ Layer.succeed(PresenceMaker)({ make: PresenceController.makePresence, events: PresenceController.exitCompleteEvents, propagateTo: PresenceController.propagateTo }),
}
