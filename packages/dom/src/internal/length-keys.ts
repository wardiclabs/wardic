/**
 * The CSS lengths a bare number on is drawn in `px`, spelled as Wardic's keys are (`margin-top`). The DOM
 * renderer draws them, and `LiveStyle` hands such a number in an element's `style` to it.
 *
 * @module
 */
/**
 * The CSS properties a bare number on is a length, drawn in `px`, spelled as Wardic's keys are
 * (`margin-top`): Motion's, and `min-width`, `min-height`, the gaps and `letter-spacing`. The Solid
 * bindings' value types take a number on these and on no other length, so a number never draws CSS a
 * browser drops. `line-height` isn't one: CSS reads its bare number as a multiple. A number on any other
 * key, `opacity`, `z-index`, a custom property, is drawn as it is; a string always is.
 */
// #522: Motion's `numberValueTypes`' `px` keys; the bindings' `WardicValues`.
export const LENGTH_KEYS = [
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "letter-spacing",
  "background-position-x",
  "background-position-y",
  // An element's children's depth (#887), Motion's: the property beside the element's own `transformPerspective`.
  "perspective",
] as const

/** One of `LENGTH_KEYS`: a CSS property a bare number on is drawn in `px`. */
export type LengthKey = (typeof LENGTH_KEYS)[number]

/** {@link LENGTH_KEYS}, for a membership test a frame can make. */
export const LENGTH_KEY_SET: ReadonlySet<string> = new Set(LENGTH_KEYS)
