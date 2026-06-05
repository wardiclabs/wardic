/**
 * `measureLayoutBox` — read an element's UNTRANSFORMED layout box (ADR-0005 /
 * ADR-0009 transform-reset-on-measure). Shared by the projection system and the
 * (transitional) `<LayoutGroup>` path; it lives in its own module so neither has
 * to import the other (keeping the provider↔layout↔projection imports acyclic).
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
