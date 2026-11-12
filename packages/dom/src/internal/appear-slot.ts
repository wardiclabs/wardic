/**
 * An Appear animation's slot on its element (#48, ADR-0044), as a page's code reads it before any Handoff:
 * whether the element's animation still runs, and the Handoff's last step, its removal. Kept apart from the
 * sampler and the Handoff's reads (`appear.ts`), so code that only asks, or lets one go, ships neither: a
 * Batch's, whose reads load at its first Handoff (#706, Q11).
 *
 * @module
 */

/** The prefix every Appear rule's name starts with. */
export const PREFIX = "wardic-"

/** What a slot's inline `animation` starts with: `var(--wardic-a`. */
const SLOT_PREFIX = `var(--${PREFIX}a`

/**
 * Whether `element`'s Appear animation is running, not yet handed over: its inline style still names its
 * slot, which `release` removes. A layout measure asks it of each node, so a running animation's
 * transform, which beats the inline one, stays out of the box it reads.
 */
// #245: a Measure pass; a string read, no style resolved.
export const pending = (element: ElementCSSInlineStyle): boolean => element.style.getPropertyValue("animation").startsWith(SLOT_PREFIX)

/**
 * The handover's last step: the element's inline `animation` removed, in the task that writes the
 * engine's first frame, so no paint falls between. While it ran, its value beat the inline style the
 * engine writes; removing it ends the CSS animation at that task's style update.
 */
// The **Handoff** (ADR-0044, decision 6). A `cancel()` too changed nothing (a mutation, #48's PR 1).
export const release = (element: ElementCSSInlineStyle): void => {
  element.style.removeProperty("animation")
}
