/**
 * The DOM reads the layout engine takes at measure time (ADR-0005 / ADR-0009 /
 * ADR-0012). Two box readers: {@link readLayoutBox} is the raw rect the projection
 * pass uses (it owns the transform reset at pass level), {@link measureLayoutBox}
 * the self-resetting single-element read the binding's transitional
 * `<LayoutGroup>` path uses. No framework or Effect dependency — pure DOM — so
 * this lives in `@wardic/dom` alongside the projection engine that consumes it (a
 * binding imports it from here).
 */
import type { Bounds, Point } from "@wardic/core"

/**
 * Read `el`'s box AS IT CURRENTLY RENDERS — a raw `getBoundingClientRect`, no
 * transform reset. The projection measure pass uses this because it resets the
 * whole tree's transforms in its own WRITE phase first, so by the time it reads,
 * nothing is transformed (see `runMeasurePass`). A lone caller wants
 * {@link measureLayoutBox} instead.
 */
export const readLayoutBox = (el: HTMLElement): Bounds => {
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
 * Single-element use only (the binding's transitional `SharedLayoutContext` seed
 * reads). It is NOT enough inside a tree pass: `getBoundingClientRect` is
 * viewport-space, so an ANCESTOR's transform pollutes the reading too, and the
 * `finally` restores before the next element is read — which is why the projection
 * pass hoists the reset out to pass level rather than widening it here.
 */
export const measureLayoutBox = (el: HTMLElement): Bounds => {
  const saved = el.style.transform
  el.style.transform = ""
  try {
    return readLayoutBox(el)
  } finally {
    el.style.transform = saved
  }
}

/** An element's scroll offset (ADR-0012, Motion's `measureScroll`). */
export const measureScroll = (el: HTMLElement): Point => ({ x: el.scrollLeft, y: el.scrollTop })

/**
 * Whether `el` is a scroll ROOT (ADR-0012, Motion's `checkIsScrollRoot`): a
 * `position: fixed` element establishes a viewport-relative frame, so its subtree
 * doesn't fold in page (or outer-container) scroll.
 */
export const isScrollRoot = (el: HTMLElement): boolean => getComputedStyle(el).position === "fixed"

/**
 * The document's scroll offset (the page/window scroll, ADR-0012, Motion's
 * `DocumentProjectionNode` root). Folded into every box unless it sits in a scroll
 * root. SSR-safe (returns origin when there is no document).
 */
export const measureDocumentScroll = (): Point => {
  if (typeof document === "undefined") return { x: 0, y: 0 }
  const doc = document.documentElement
  return {
    x: doc.scrollLeft || document.body?.scrollLeft || 0,
    y: doc.scrollTop || document.body?.scrollTop || 0,
  }
}
