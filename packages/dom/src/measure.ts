/**
 * The DOM reads the layout engine takes at measure time (ADR-0005 / ADR-0009 /
 * ADR-0012). Two box readers: {@link readLayoutBox} is the raw rect the projection
 * pass uses (it owns the transform reset at pass level), {@link measureLayoutBox}
 * a self-resetting single-element read for a lone caller. No framework or Effect dependency — pure DOM — so
 * this lives in `@wardic/dom` alongside the projection engine that consumes it (a
 * binding imports it from here).
 */
import type * as Point from "@wardic/core/Point"
import type * as Probe from "@wardic/core/Probe"

/**
 * Read `el`'s box AS IT CURRENTLY RENDERS — a raw `getBoundingClientRect`, no
 * transform reset. The projection measure pass uses this because it resets the
 * whole tree's transforms in its own WRITE phase first, so by the time it reads,
 * nothing is transformed (see `runMeasurePass`). A lone caller wants
 * {@link measureLayoutBox} instead.
 */
export const readLayoutBox = (el: HTMLElement): Probe.Bounds => {
  const r = el.getBoundingClientRect()
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    left: r.left,
  }
}

/**
 * Measure `el`'s box with its OWN in-flight transform cleared, so an active FLIP /
 * `animate` transform never distorts the reading. The inline `transform` is
 * temporarily blanked, the rect read, then the exact prior value restored — in a
 * `finally`, so a throwing `getBoundingClientRect` can't leave the element reset.
 *
 * Single-element use only. It is NOT enough inside a tree pass: `getBoundingClientRect` is
 * viewport-space, so an ANCESTOR's transform pollutes the reading too, and the
 * `finally` restores before the next element is read — which is why the projection
 * pass hoists the reset out to pass level rather than widening it here.
 */
export const measureLayoutBox = (el: HTMLElement): Probe.Bounds => {
  const saved = el.style.transform
  el.style.transform = ""
  try {
    return readLayoutBox(el)
  } finally {
    el.style.transform = saved
  }
}

/** An element's scroll offset (ADR-0012, Motion's `measureScroll`). */
export const measureScroll = (el: HTMLElement): Point.Point => ({ x: el.scrollLeft, y: el.scrollTop })

/**
 * Whether `el` is a scroll ROOT (ADR-0012, Motion's `checkIsScrollRoot`): a
 * `position: fixed` element establishes a viewport-relative frame, so its subtree
 * doesn't fold in page (or outer-container) scroll.
 */
export const isScrollRoot = (el: HTMLElement): boolean => getComputedStyle(el).position === "fixed"

/** The overflow values that never scroll: anything else can (`hidden` too, from code). */
const UNSCROLLED = new Set(["visible", "clip"])

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

/** {@link ScrollStyle} of `el`, uncached: one `getComputedStyle` per call. */
export const readScrollStyle = (el: Element): ScrollStyle => {
  const style = getComputedStyle(el)
  return {
    scrollable: !UNSCROLLED.has(style.overflowX) || !UNSCROLLED.has(style.overflowY),
    fixed: style.position === "fixed",
  }
}

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

/**
 * The document's scroll offset (the page/window scroll, ADR-0012, Motion's
 * `DocumentProjectionNode` root). Folded into every box unless it sits in a scroll
 * root. SSR-safe (returns origin when there is no document).
 */
export const measureDocumentScroll = (): Point.Point => {
  if (typeof document === "undefined") return { x: 0, y: 0 }
  const doc = document.documentElement
  return {
    x: doc.scrollLeft || document.body?.scrollLeft || 0,
    y: doc.scrollTop || document.body?.scrollTop || 0,
  }
}
