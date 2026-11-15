/**
 * Presence's records over the DOM's Subjects, its elements: what solid's modules, and its
 * `PresenceRecord` and `PresenceContextValue`, name. The protocol, over any Environment's Subjects, is
 * `presence-protocol.ts`'s.
 *
 * @module
 */
// #672: the protocol is generic over its Subject, for core to share it; the DOM bindings' presence,
// spines and public types keep `Element`, as before the lift.
import type * as Protocol from "./presence-protocol.ts"

export * from "./presence-protocol.ts"

/** A child's live presence registration ({@link Protocol.PresenceRecord}), its Subject an element. */
export type PresenceRecord = Protocol.PresenceRecord<Element>

/** The value `<AnimatePresence>` publishes to descendant `createWard` spines ({@link Protocol.PresenceContextValue}), over elements. */
export type PresenceContextValue = Protocol.PresenceContextValue<Element>

/** What a presence hook registers ({@link Protocol.PresenceWatch}), its Subject an element. */
export type PresenceWatch = Protocol.PresenceWatch<Element>
