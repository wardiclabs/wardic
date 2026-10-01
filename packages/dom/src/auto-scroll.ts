/**
 * The DOM's **Auto-scroll** (ADR-0020, grill decision 16): Motion's
 * (Reorder/utils/auto-scroll.ts at 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts)
 * over core's pure `autoScrollStep`. While a **Reorder group**'s item is dragged near
 * the visible edge of the group's scroller, moving toward it, each drag update scrolls
 * the scroller; the scroll then moves the held pointer (a synthetic move), whose update
 * scrolls again, so it keeps scrolling while the pointer holds still in the zone.
 */
import { autoScrollStep, type AutoScrollState, type Point } from "@wardic/core"
import { heldScrollShift } from "./input.ts"

/** The overflow values Motion's auto-scroll scrolls (auto-scroll.ts:4). */
const SCROLLS = new Set(["auto", "scroll"])

/** A scroller on one axis: an element, or the document (the window's scroll). */
type Scroller = { readonly kind: "element"; readonly el: HTMLElement } | { readonly kind: "document"; readonly win: Window }

/**
 * The **Auto-scroll** of one group. `update(pointer, axis, velocity, item?)` takes the
 * pointer in viewport px, the axis to scroll and the pointer's velocity on it; given
 * the dragged item's element, `pointer` may instead be its drag point, which carries
 * the scroll since the hold began (ADR-0019 *Amendment (Reorder)*), and the scroller
 * takes that back out. `reset()` ends the gesture: the next update finds the scroller
 * afresh and needs velocity toward an edge again.
 */
export interface AutoScroller {
  readonly update: (pointer: Point, axis: "x" | "y", velocity: number, item?: Element) => void
  readonly reset: () => void
}

/**
 * The nearest ancestor of `group` that scrolls on `axis` (`overflow` `auto | scroll`),
 * or the document once the walk reaches `body` (Motion's `findScrollableAncestor`).
 */
const findScroller = (group: Element, axis: "x" | "y"): Scroller | undefined => {
  const doc = group.ownerDocument
  const win = doc.defaultView
  for (let cur = group.parentElement; cur !== null; cur = cur.parentElement) {
    if (cur === doc.body || cur === doc.documentElement) return win !== null ? { kind: "document", win } : undefined
    const style = getComputedStyle(cur)
    if (SCROLLS.has(axis === "x" ? style.overflowX : style.overflowY)) return { kind: "element", el: cur }
  }
  return undefined
}

/**
 * Build the **Auto-scroll** for `group` (the Reorder group's element). The scroller on
 * each axis is found once per gesture, at its first update. Each update reads the
 * scroller's visible edges (clamped to the viewport, as Motion's `getScrollAmount`), runs
 * core's `autoScrollStep`, and scrolls by its amount. `debug` receives `auto-scroll
 * start` and `auto-scroll stop` { axis, edge } when an edge starts and ends scrolling.
 */
export const makeAutoScroller = (
  group: Element,
  debug?: (event: string, annotations: Record<string, unknown>) => void,
): AutoScroller => {
  const scrollers = new Map<"x" | "y", Scroller | undefined>()
  const states = new Map<"x" | "y", AutoScrollState>()

  const setState = (axis: "x" | "y", next: AutoScrollState | undefined): void => {
    const prev = states.get(axis)
    if (prev?.edge === next?.edge) {
      if (next !== undefined) states.set(axis, next)
      return
    }
    if (prev !== undefined) debug?.("auto-scroll stop", { axis, edge: prev.edge })
    if (next !== undefined) {
      states.set(axis, next)
      debug?.("auto-scroll start", { axis, edge: next.edge })
    } else {
      states.delete(axis)
    }
  }

  return {
    update: (pointer, axis, velocity, item) => {
      let scroller = scrollers.get(axis)
      if (!scrollers.has(axis)) {
        scroller = findScroller(group, axis)
        scrollers.set(axis, scroller)
      }
      if (scroller === undefined) return
      const shift = item !== undefined ? heldScrollShift(item) : undefined
      const at = (axis === "x" ? pointer.x : pointer.y) - (shift === undefined ? 0 : axis === "x" ? shift.x : shift.y)
      let start: number
      let end: number
      let scroll: number
      let maxScroll: () => number
      if (scroller.kind === "document") {
        const { win } = scroller
        const root = win.document.documentElement
        start = 0
        end = axis === "x" ? win.innerWidth : win.innerHeight
        scroll = axis === "x" ? win.scrollX : win.scrollY
        maxScroll = () => (axis === "x" ? root.scrollWidth - win.innerWidth : root.scrollHeight - win.innerHeight)
      } else {
        const { el } = scroller
        const rect = el.getBoundingClientRect()
        const win = el.ownerDocument.defaultView
        start = Math.max(0, axis === "x" ? rect.left : rect.top)
        end = Math.min(axis === "x" ? (win?.innerWidth ?? rect.right) : (win?.innerHeight ?? rect.bottom), axis === "x" ? rect.right : rect.bottom)
        scroll = axis === "x" ? el.scrollLeft : el.scrollTop
        maxScroll = () => (axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight)
      }
      const step = autoScrollStep(states.get(axis), { pointer: at, start, end, velocity, scroll, maxScroll })
      setState(axis, step.state)
      if (step.amount === 0) return
      if (scroller.kind === "document") scroller.win.scrollBy(axis === "x" ? { left: step.amount } : { top: step.amount })
      else if (axis === "x") scroller.el.scrollLeft += step.amount
      else scroller.el.scrollTop += step.amount
    },
    reset: () => {
      for (const axis of [...states.keys()]) setState(axis, undefined)
      scrollers.clear()
    },
  }
}
