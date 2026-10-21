/**
 * Watching a container's content for size changes: its direct children on a `ResizeObserver`, each
 * observed now and as it's added, and let go as it's removed. A deep change counts once it resizes
 * the direct child it sits in.
 *
 * - `Probe.scroll` watches a container's (the page's: the body's), so its range follows its content
 *   (#239, ADR-0043 *Amendment (#239)*).
 * - The layout engine watches the page's, so a node that content elsewhere moved is measured again
 *   (#261, ADR-0018 *Amendment (#261)*).
 *
 * The observer is shared by count: a box watched for two reasons (a scroll target that is also a
 * child, a layout node that is also a page box) stays watched until both let go.
 */
import * as Arr from "effect/Array"
import { constVoid } from "effect/Function"
import * as Option from "effect/Option"

/** Observing and letting go of boxes on one observer, each counted by the reasons it's watched for. */
export interface Watched {
  readonly observe: (box: Element) => void
  readonly unobserve: (box: Element) => void
}

/** {@link Watched} over `observer`, every box observed with `options`. */
export const counted = (observer: ResizeObserver, options?: ResizeObserverOptions): Watched => {
  const counts = new Map<Element, number>()
  const countOf = (box: Element): number => Option.getOrElse(Option.fromUndefinedOr(counts.get(box)), () => 0)
  return {
    observe: (box) => {
      const count = countOf(box)
      counts.set(box, count + 1)
      if (count === 0) observer.observe(box, options)
    },
    unobserve: (box) => {
      const count = countOf(box)
      if (count === 0) return
      if (count > 1) {
        counts.set(box, count - 1)
        return
      }
      counts.delete(box)
      observer.unobserve(box)
    },
  }
}

/**
 * Watch `parent`'s direct children on `watched`, kept current by a `MutationObserver` on its child list.
 * `onChildren` runs after each change to the list, its children watched by then. Returns the stop; the
 * observer's own disconnect lets go of the boxes.
 */
export const watchChildren = (parent: Element, watched: Watched, onChildren: () => void): (() => void) => {
  Arr.forEach(Array.from(parent.children), watched.observe)
  const children = new MutationObserver((records) => {
    Arr.forEach(records, (record) => {
      Arr.forEach(Array.from(record.addedNodes), (node) => {
        if (node instanceof Element) watched.observe(node)
      })
      Arr.forEach(Array.from(record.removedNodes), (node) => {
        if (node instanceof Element) watched.unobserve(node)
      })
    })
    onChildren()
  })
  children.observe(parent, { childList: true })
  return () => children.disconnect()
}

/**
 * Watch the page's content on `watched`: the body and its direct children (a body sized to the window
 * doesn't grow with what overflows it), as {@link watchChildren} watches a container's. None with no
 * body (a server, a document not parsed that far). Returns the stop.
 */
export const watchPage = (watched: Watched, onChildren: () => void): (() => void) =>
  Option.match(
    Option.flatMap(Option.fromUndefinedOr((globalThis as { readonly document?: Document }).document), (page) => Option.fromNullOr(page.body)),
    {
      onNone: () => constVoid,
      onSome: (body) => {
        watched.observe(body)
        return watchChildren(body, watched, onChildren)
      },
    },
  )
