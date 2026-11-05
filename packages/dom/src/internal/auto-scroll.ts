/**
 * The DOM's **Auto-scroll** (ADR-0020, grill decision 16): Motion's
 * (Reorder/utils/auto-scroll.ts at 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts)
 * over core's pure `AutoScroll.step`. While a **Reorder group**'s item is dragged near
 * the visible edge of the group's scroller, moving toward it, each drag update scrolls
 * the scroller; the scroll then moves the held pointer (a synthetic move), whose update
 * scrolls again, so it keeps scrolling while the pointer holds still in the zone.
 */
import * as AutoScroll from "@wardic/core/AutoScroll"
import type * as Point from "@wardic/core/Point"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equal from "effect/Equal"
import { constVoid } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import { heldScrollShift } from "./input.ts"

/** The overflow values Motion's auto-scroll scrolls (auto-scroll.ts:4). */
const SCROLLS: ReadonlySet<string> = new Set(["auto", "scroll"])

type Axis = "x" | "y"

/** A scroller on one axis: an element, or the document (the window's scroll). */
type Scroller = { readonly kind: "element"; readonly el: HTMLElement } | { readonly kind: "document"; readonly win: Window }

/** A scroller's extent on one axis: its visible edges in viewport px, its scroll, and how far it can scroll. */
interface View {
  readonly start: number
  readonly end: number
  readonly scroll: number
  readonly maxScroll: () => number
}

/**
 * The **Auto-scroll** of one group. `update(pointer, axis, velocity, item?)` takes the
 * pointer in viewport px, the axis to scroll and the pointer's velocity on it; given
 * the dragged item's element, `pointer` may instead be its drag point, which carries
 * the scroll since the hold began (ADR-0019 *Amendment (Reorder)*), and the scroller
 * takes that back out. `reset()` ends the gesture: the next update finds the scroller
 * afresh and needs velocity toward an edge again.
 */
export interface AutoScroller {
  readonly update: (pointer: Point.Point, axis: Axis, velocity: number, item?: Element) => void
  readonly reset: () => void
}

const ZERO: Point.Point = { x: 0, y: 0 }

/**
 * The nearest ancestor of `group` that scrolls on `axis` (`overflow` `auto | scroll`),
 * or the document once the walk reaches `body` (Motion's `findScrollableAncestor`).
 */
const findScroller = (group: Element, axis: Axis): Option.Option<Scroller> => {
  const doc = group.ownerDocument
  const from = (cur: HTMLElement | null): Option.Option<Scroller> =>
    Option.flatMap(Option.fromNullOr(cur), (el) =>
      Bool.match(el === doc.body || el === doc.documentElement, {
        onTrue: () => Option.map(Option.fromNullOr(doc.defaultView), (win): Scroller => ({ kind: "document", win })),
        onFalse: () => {
          const style = getComputedStyle(el)
          return Bool.match(SCROLLS.has({ x: style.overflowX, y: style.overflowY }[axis]), {
            onTrue: () => Option.some<Scroller>({ kind: "element", el }),
            onFalse: () => from(el.parentElement),
          })
        },
      })
    )
  return from(group.parentElement)
}

/** `scroller`'s extent on `axis`: an element's visible edges are clamped to the viewport, as Motion's `getScrollAmount`. */
const viewOf = (scroller: Scroller, axis: Axis): View =>
  Match.value(scroller).pipe(
    Match.when({ kind: "document" }, ({ win }): View => {
      const root = win.document.documentElement
      return {
        start: 0,
        end: { x: win.innerWidth, y: win.innerHeight }[axis],
        scroll: { x: win.scrollX, y: win.scrollY }[axis],
        maxScroll: { x: () => root.scrollWidth - win.innerWidth, y: () => root.scrollHeight - win.innerHeight }[axis],
      }
    }),
    Match.when({ kind: "element" }, ({ el }): View => {
      const rect = el.getBoundingClientRect()
      const win = Option.fromNullOr(el.ownerDocument.defaultView)
      const viewport = {
        x: Option.match(win, { onNone: () => rect.right, onSome: (w) => w.innerWidth }),
        y: Option.match(win, { onNone: () => rect.bottom, onSome: (w) => w.innerHeight }),
      }
      return {
        start: Math.max(0, { x: rect.left, y: rect.top }[axis]),
        end: Math.min(viewport[axis], { x: rect.right, y: rect.bottom }[axis]),
        scroll: { x: el.scrollLeft, y: el.scrollTop }[axis],
        maxScroll: { x: () => el.scrollWidth - el.clientWidth, y: () => el.scrollHeight - el.clientHeight }[axis],
      }
    }),
    Match.exhaustive,
  )

/** Scroll `scroller` by `amount` on `axis`. */
const scrollBy = (scroller: Scroller, axis: Axis, amount: number): void =>
  Match.value(scroller).pipe(
    Match.when({ kind: "document" }, ({ win }) => win.scrollBy({ x: { left: amount }, y: { top: amount } }[axis])),
    Match.when({ kind: "element" }, ({ el }) =>
      Match.value(axis).pipe(
        Match.when("x", () => {
          el.scrollLeft += amount
        }),
        Match.orElse(() => {
          el.scrollTop += amount
        }),
      )
    ),
    Match.exhaustive,
  )

const edgeOf = (state: AutoScroll.State): AutoScroll.State["edge"] => state.edge

/**
 * Build the **Auto-scroll** for `group` (the Reorder group's element). The scroller on
 * each axis is found once per gesture, at its first update. Each update reads the
 * scroller's visible edges (clamped to the viewport, as Motion's `getScrollAmount`), runs
 * core's `AutoScroll.step`, and scrolls by its amount. `debug` receives `auto-scroll
 * start` and `auto-scroll stop` { axis, edge } when an edge starts and ends scrolling.
 */
export const makeAutoScroller = (
  group: Element,
  debug?: (event: string, annotations: Record<string, unknown>) => void,
): AutoScroller => {
  const log = UndefinedOr.match(debug, { onUndefined: () => constVoid, onDefined: (d) => d })
  // Each axis's scroller, found at the gesture's first update (`None` when there is none).
  const scrollers = new Map<Axis, Option.Option<Scroller>>()
  const states = new Map<Axis, AutoScroll.State>()

  const setState = (axis: Axis, next: Option.Option<AutoScroll.State>): void => {
    const prev = Option.fromUndefinedOr(states.get(axis))
    const edgeChanged = Bool.not(Equal.equals(Option.map(prev, edgeOf), Option.map(next, edgeOf)))
    if (edgeChanged && Option.isSome(prev)) log("auto-scroll stop", { axis, edge: prev.value.edge })
    Option.match(next, {
      onNone: () => states.delete(axis),
      onSome: (state) => states.set(axis, state),
    })
    if (edgeChanged && Option.isSome(next)) log("auto-scroll start", { axis, edge: next.value.edge })
  }

  return {
    update: (pointer, axis, velocity, item) => {
      const scroller = Option.getOrElse(Option.fromUndefinedOr(scrollers.get(axis)), () => {
        const found = findScroller(group, axis)
        scrollers.set(axis, found)
        return found
      })
      if (Option.isNone(scroller)) return
      const shift = UndefinedOr.match(item, { onUndefined: () => ZERO, onDefined: heldScrollShift })
      const view = viewOf(scroller.value, axis)
      const step = AutoScroll.step(Option.fromUndefinedOr(states.get(axis)), {
        pointer: pointer[axis] - shift[axis],
        start: view.start,
        end: view.end,
        velocity,
        scroll: view.scroll,
        maxScroll: view.maxScroll,
      })
      setState(axis, step.state)
      if (step.amount === 0) return
      scrollBy(scroller.value, axis, step.amount)
    },
    reset: () => {
      Arr.forEach(Arr.fromIterable(states.keys()), (axis) => setState(axis, Option.none()))
      scrollers.clear()
    },
  }
}
