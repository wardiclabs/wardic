/**
 * The DOM's **Announcement** channel (ADR-0037): `AnnouncerDomLive`, core's `Announcer.Announcer` as
 * one visually hidden live region per document, `aria-live="assertive"` and `aria-atomic`, shared by
 * every Reorder group on the page. Assertive, because each announcement answers a key just pressed;
 * the caller thins a held arrow's repeats to the last. Each announcement replaces the last, and one
 * that repeats the last (an arrow at an end re-announcing the position) gets a trailing no-break
 * space, so a screen reader sees a change and speaks it again.
 *
 * A screen reader watches a live region from when it's in the page, so the region has to be there
 * before the first announcement: {@link prepareAnnouncer} adds it (a Reorder group's controller calls
 * it when its element attaches), and an announcement adds it too if nothing did.
 *
 * {@link instructionsId} gives the id of a hidden element holding a group's instructions, one per
 * distinct text per document, for its items' `aria-describedby`.
 *
 * Client-only (ADR-0021, decision 7): building the layer on a server fails with the client-only error.
 *
 * Tier 2 (ADR-0008): for DOM binding authors.
 */
import * as Announcer from "@wardic/core/Announcer"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { requireGlobal } from "./require-global.ts"

/** The attribute that marks the live region, for a test or a stylesheet to find it. */
export const ANNOUNCER_ATTRIBUTE = "data-wardic-announcer"

/** Hidden from sight, not from assistive technology: the usual visually hidden rule. */
const VISUALLY_HIDDEN =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap"

/** Each document's live region, once added. */
const regions = new WeakMap<Document, HTMLElement>()

/** `doc`'s live region, added to its body when it has none. */
const regionOf = (doc: Document): HTMLElement => {
  const existing = regions.get(doc)
  if (existing !== undefined && existing.isConnected) return existing
  const region = doc.createElement("div")
  region.setAttribute(ANNOUNCER_ATTRIBUTE, "")
  region.setAttribute("aria-live", "assertive")
  region.setAttribute("aria-atomic", "true")
  region.setAttribute("style", VISUALLY_HIDDEN)
  doc.body.appendChild(region)
  regions.set(doc, region)
  return region
}

/**
 * The live document `node` is in: its own when that has a window, else the page's. A Solid ref
 * runs while a new element still belongs to its template's inert document (no window, no body),
 * before it's inserted.
 */
export const documentOf = (node: Node): Document => {
  const doc = node.ownerDocument
  if (doc === null || doc.defaultView === null) return document
  return doc
}

/** Add `doc`'s live region now, before its first announcement, so a screen reader is watching it. */
export const prepareAnnouncer = (doc: Document): void => {
  regionOf(doc)
}

/** Speak `message` in `doc`'s live region, replacing the last; a repeat of the last gets a trailing no-break space. */
export const announceIn = (doc: Document, message: string): void => {
  const region = regionOf(doc)
  region.textContent = Bool.match(region.textContent === message, { onTrue: () => `${message}\u00A0`, onFalse: () => message })
}

/** Each document's instructions elements, by text. */
const instructions = new WeakMap<Document, Map<string, string>>()
let nextInstructions = 1

/**
 * The id of `doc`'s hidden element holding `text`, added on first use: one per distinct text, for
 * the `aria-describedby` of every item that shows it.
 */
export const instructionsId = (doc: Document, text: string): string => {
  let byText = instructions.get(doc)
  if (byText === undefined) {
    byText = new Map()
    instructions.set(doc, byText)
  }
  const existing = byText.get(text)
  if (existing !== undefined && doc.getElementById(existing) !== null) return existing
  const id = `wardic-instructions-${nextInstructions++}`
  const el = doc.createElement("div")
  el.id = id
  el.hidden = true
  el.textContent = text
  doc.body.appendChild(el)
  byText.set(text, id)
  return id
}

/** Core's `Announcer` on the page's `document` (see the module doc). */
export const AnnouncerDomLive: Layer.Layer<Announcer.Announcer> = Layer.effect(Announcer.Announcer)(
  Effect.gen(function* () {
    yield* requireGlobal("AnnouncerDomLive", "document")
    return Announcer.Announcer.of({ announce: (message) => announceIn(document, message) })
  }),
)
