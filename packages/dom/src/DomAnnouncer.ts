/**
 * The DOM's `Announcer`: a shared assertive live region, and the helpers a binding uses for a Reorder group's instructions (ADR-0037).
 *
 * `@wardic/dom/DomAnnouncer` (#132, ADR-0041).
 */
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
