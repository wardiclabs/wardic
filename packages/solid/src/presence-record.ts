/**
 * Presence's records over the DOM's Subjects, its elements: what solid's modules, and its
 * `PresenceRecord` and `PresenceContextValue`, name. The protocol, over any Environment's Subjects, is
 * core's (`@wardic/core/unstable/PresenceRecord`); its forms over elements are the DOM's presence's
 * (`presence-controller.ts`).
 *
 * @module
 */
// #672 (PR5-Q3): the DOM's three forms are the presence controller's, which goes to dom with them; the
// DOM bindings' presence, spines and public types keep `Element`, as before the lift.
export * from "@wardic/core/unstable/PresenceRecord"
export type { PresenceContextValue, PresenceRecord, PresenceWatch } from "./presence-controller.ts"
