/**
 * Which scrollers move an element on screen (ADR-0012), apart from the Measure pass (#548): the gesture
 * input and the reveals read `scrollersOf` on every page, so it sits in a module of its own, and the
 * Projection system's reads, in `measure.ts`, ship only where an app lays out (ADR-0067,
 * *Amendment (#548)*). Per node in the Measure pass: a `for` up the ancestors (ADR-0025, dom's
 * per-frame files).
 */

/** The overflow values that never scroll: anything else can (`hidden` too, from code). */
const UNSCROLLED: ReadonlySet<string> = new Set(["visible", "clip"])

/**
 * What the scroll fold and a scroll feed need from an element's style, from one
 * `getComputedStyle` read (ADR-0012, *Amendment (Reorder)*): whether it can scroll on
 * either axis (`overflow-x` or `overflow-y` neither `visible` nor `clip`; Motion's
 * auto-scroll asks for `auto | scroll`, but a `hidden` container can still be scrolled
 * from code), and whether it is `position: fixed` (its subtree is viewport-relative,
 * so no scroll outside it moves anything inside).
 */
export interface ScrollStyle {
  readonly scrollable: boolean
  readonly fixed: boolean
}

/** {@link ScrollStyle} from an element's computed style. */
export const scrollStyleFrom = (style: CSSStyleDeclaration): ScrollStyle => ({
  scrollable: !UNSCROLLED.has(style.overflowX) || !UNSCROLLED.has(style.overflowY),
  fixed: style.position === "fixed",
})

/** {@link ScrollStyle} of `el`, uncached: one `getComputedStyle` per call. */
export const readScrollStyle = (el: Element): ScrollStyle => scrollStyleFrom(getComputedStyle(el))

/**
 * The scrollers whose scroll moves `el` on screen: its ancestors that can scroll,
 * nearest first, up to the first `position: fixed` one (included if it scrolls), and
 * whether the page's scroll does (no fixed element on the way, `el` included). The
 * walk stops before `body` and `documentElement`: the page's own scroll is the
 * window's.
 */
export const scrollersOf = (el: Element): { readonly ancestors: Array<Element>; readonly page: boolean } => {
  const ancestors: Array<Element> = []
  if (readScrollStyle(el).fixed) return { ancestors, page: false }
  const doc = el.ownerDocument
  for (let cur = el.parentElement; cur !== null && cur !== doc.body && cur !== doc.documentElement; cur = cur.parentElement) {
    const style = readScrollStyle(cur)
    if (style.scrollable) ancestors.push(cur)
    if (style.fixed) return { ancestors, page: false }
  }
  return { ancestors, page: true }
}
