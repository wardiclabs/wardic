/**
 * `measureLayoutBox` — read an element's UNTRANSFORMED layout box (ADR-0005 /
 * ADR-0009 transform-reset-on-measure). Used by the projection system and the
 * binding's (transitional) `<LayoutGroup>` path. It has no framework or Effect
 * dependency — pure DOM — so it lives in `@wardic/dom` alongside the projection
 * engine that consumes it (a binding imports it from here).
 */
import type { Bounds, Point } from "@wardic/core"

/**
 * Measure `el`'s box with any in-flight transform cleared, so an active FLIP /
 * `animate` transform never distorts the reading. The inline `transform` is
 * temporarily blanked, the rect read, then the exact prior value restored — in a
 * `finally`, so a throwing `getBoundingClientRect` can't leave the element reset.
 */
export const measureLayoutBox = (el: HTMLElement): Bounds => {
  const saved = el.style.transform
  el.style.transform = ""
  try {
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
