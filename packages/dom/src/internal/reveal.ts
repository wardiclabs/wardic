/**
 * Keep a **Keyboard reorder**'s item in view (ADR-0037, Q13): after a step, scroll its new place
 * into view, as little as needed, in each scroller that moves it and then the page, as
 * `scrollIntoView({ block: "nearest", inline: "nearest" })` would. Its new place, not where it's
 * drawn: a step's layout animation starts it where it was, so the box is the element's painted one
 * with its own transform (a translate and a scale about its origin) undone. Instant, so it never
 * runs against the step's own animation, and with nothing for reduced motion to stop.
 *
 * @internal for the Reorder controller.
 */
import { scrollersOf } from "./scrollers.ts"
import * as Arr from "effect/Array"

/** A box on screen, in client coordinates. */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * `el`'s layout box on screen: its painted box with its own transform undone. A translate and a
 * scale (the projection's) about its `transform-origin`; a box drawn with no transform is as painted.
 */
export const layoutRectOf = (el: Element): Rect => {
  const painted = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const m = new DOMMatrixReadOnly(style.transform)
  if (m.isIdentity) return painted
  if (m.a === 0) return painted
  if (m.d === 0) return painted
  const [ox = 0, oy = 0] = style.transformOrigin.split(" ").map((v) => Number.parseFloat(v))
  const left = painted.left - m.e - ox * (1 - m.a)
  const top = painted.top - m.f - oy * (1 - m.d)
  return { left, top, right: left + painted.width / m.a, bottom: top + painted.height / m.d }
}

/**
 * How far to scroll a view from `viewMin` to `viewMax` so `min` to `max` shows: 0 when it does, else
 * the least that brings it in, its start first when it can't all fit.
 */
const scrollToShow = (min: number, max: number, viewMin: number, viewMax: number): number => {
  if (min < viewMin) return min - viewMin
  if (max > viewMax) return Math.min(max - viewMax, min - viewMin)
  return 0
}

/** Scroll `el`'s new place into view (see the module doc): its layout box, its own transform undone. */
export const revealLayoutOf = (el: Element): void => revealRectOf(el, layoutRectOf(el))

/**
 * Scroll `place`, `el`'s place on screen, into view in each scroller around `el` and then the page: a
 * placed item's (#712), whose place is computed, not where it's drawn.
 */
export const revealRectOf = (el: Element, place: Rect): void => {
  const { ancestors, page } = scrollersOf(el)
  // Each scroller in turn, nearest first: what it scrolls moves the element for the next.
  const rect = Arr.reduce(ancestors, place, (rect, scroller) => {
    const box = scroller.getBoundingClientRect()
    const top = box.top + scroller.clientTop
    const left = box.left + scroller.clientLeft
    const dy = scrollToShow(rect.top, rect.bottom, top, top + scroller.clientHeight)
    const dx = scrollToShow(rect.left, rect.right, left, left + scroller.clientWidth)
    if (dx === 0 && dy === 0) return rect
    scroller.scrollBy({ left: dx, top: dy, behavior: "instant" })
    return { left: rect.left - dx, top: rect.top - dy, right: rect.right - dx, bottom: rect.bottom - dy }
  })
  const win = el.ownerDocument.defaultView
  if (page && win !== null) {
    const dy = scrollToShow(rect.top, rect.bottom, 0, win.innerHeight)
    const dx = scrollToShow(rect.left, rect.right, 0, win.innerWidth)
    if (dx !== 0 || dy !== 0) win.scrollBy({ left: dx, top: dy, behavior: "instant" })
  }
}
