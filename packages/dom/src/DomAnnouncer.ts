/**
 * The DOM's Announcer: a shared live region, an element a screen reader watches and reads out as its
 * text changes, and the helpers a binding uses to describe a Reorder group's items to one. `layer` is
 * what `DomLive` provides; `prepare` and `announceIn` work on any document.
 *
 * @example
 * import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
 *
 * DomAnnouncer.prepare(document) // its live region, before the first announcement
 * DomAnnouncer.announceIn(document, "Picked up Milk, position 2 of 5.")
 */
// `@wardic/dom/DomAnnouncer` (#132, ADR-0041): a shared assertive live region (ADR-0037).
export {
  AnnouncerDomLive as layer,
  ANNOUNCER_ATTRIBUTE as ATTRIBUTE,
  documentOf,
  instructionsId,
  instructionsIdOf,
  showInstructions,
  prepareAnnouncer as prepare,
  announceIn,
} from "./internal/announcer.ts"
