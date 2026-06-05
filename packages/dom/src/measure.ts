/**
 * `measureLayoutBox` — read an element's UNTRANSFORMED layout box (ADR-0005 /
 * ADR-0009 transform-reset-on-measure). Used by the projection system and the
 * binding's (transitional) `<LayoutGroup>` path. It has no framework or Effect
 * dependency — pure DOM — so it lives in `@wardic/dom` alongside the projection
 * engine that consumes it (a binding imports it from here).
 */
import type { Bounds } from "@wardic/core"

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
