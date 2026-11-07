/**
 * `ScrollSource` for the DOM (#234, ADR-0043 *Amendment (#233, #234)*; the Probe's `scroll` until
 * #518): a container's scroll as an Atom, set inside the container's `scroll` event, the window's
 * `resize`, and a resize of the container or its content (#239), so a value derived from a scroll is
 * written in the frame that shows it (#45's pattern for `viewport`).
 *
 * One listener set a container, however many read it: a reader adds its own measure to the
 * container's set and takes it out when its Scope closes, and the last one out removes the
 * listeners: core's `SharedSource.counted`, not a shared Stream, so a reader sets its Atom inside the
 * event, where a Stream's consumer would set it after.
 *
 * A reader with a `target` or an `offset` reads its progress on `axis` through Motion's offsets
 * (`ScrollOffset`, the DOM's syntax; `render/dom/scroll/offsets` in framer-motion 13.4.0, ported):
 * each stop resolves to a scroll
 * position, the target's edge (in the target's length, from where it sits in the container) less
 * the container's edge (in the container's), and progress runs piecewise between them, clamped.
 *
 * **The content's size** (#239, ADR-0043 *Amendment (#239)*): content that grows or shrinks with the
 * scroll still changes the range and a target's offsets, and fires no `scroll`. One `ResizeObserver`
 * a container watches its own box and its direct children (the page: the body and its children),
 * a `MutationObserver` keeping the children watched as they're added and removed, and each reader's
 * target. A deep change resizes the direct child it sits in. Nothing runs while nothing changes; a
 * change is read after its layout, so what it moves paints a frame later. Overflow no watched box
 * shows (an absolutely positioned descendant hanging out) isn't seen: Motion's `trackContentSize`
 * reads the size every frame instead, opt-in.
 *
 * Observability: per event, so quiet (no span, no log).
 */
import * as ScrollSource from "@wardic/core/ScrollSource"
import * as SharedSource from "@wardic/core/SharedSource"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Iter from "effect/Iterable"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Rec from "effect/Record"
import type * as Scope from "effect/Scope"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import * as ScrollOffset from "../ScrollOffset.ts"
import { counted, watchChildren, watchPage } from "./content-watch.ts"

/** A container's listeners and the readers they measure for. */
interface Container {
  readonly readers: Set<() => void>
  /** Watch a reader's target's size too, until the returned function is called. */
  readonly watch: (target: Element) => () => void
  readonly remove: () => void
}

/** A position on two axes. */
interface Point {
  readonly x: number
  readonly y: number
}

/** Motion's named edges, as fractions of a length. */
const NAMED_EDGES: Readonly<Record<string, number>> = { start: 0, center: 0.5, end: 1 }

/** Whether a string is one of Motion's named edges. */
const isNamed = (edge: string): boolean => Object.hasOwn(NAMED_EDGES, edge)

/** One edge and the length it's a part of. */
interface Edge {
  readonly edge: ScrollOffset.Edge
  readonly length: number
}

/**
 * How far along `length` an edge sits: Motion's `resolveEdge`, less its inset. A name or a
 * number is a fraction of the length; `px` is a distance, `%` a fraction, `vw` / `vh` a share of
 * the viewport; any other string a fraction. Built once, at module load: per event per reader.
 */
const edgeOffset: (edge: Edge) => number = Match.type<Edge>().pipe(
  Match.when({ edge: Match.number }, ({ edge, length }) => length * edge),
  Match.when({ edge: (e: ScrollOffset.Edge) => Predicate.isString(e) && isNamed(e) }, ({ edge, length }) =>
    length * Option.getOrElse(Rec.get(NAMED_EDGES, String(edge)), () => 0)),
  Match.when({ edge: (e: ScrollOffset.Edge) => Predicate.isString(e) && Str.endsWith("px")(e) }, ({ edge }) => Number.parseFloat(String(edge))),
  Match.when({ edge: (e: ScrollOffset.Edge) => Predicate.isString(e) && Str.endsWith("%")(e) }, ({ edge, length }) =>
    (length * Number.parseFloat(String(edge))) / 100),
  Match.when({ edge: (e: ScrollOffset.Edge) => Predicate.isString(e) && Str.endsWith("vw")(e) }, ({ edge }) =>
    (Number.parseFloat(String(edge)) / 100) * document.documentElement.clientWidth),
  Match.when({ edge: (e: ScrollOffset.Edge) => Predicate.isString(e) && Str.endsWith("vh")(e) }, ({ edge }) =>
    (Number.parseFloat(String(edge)) / 100) * document.documentElement.clientHeight),
  Match.orElse(({ edge, length }) => length * Number.parseFloat(String(edge))),
)

/** A stop's two edges, the target's then the container's. */
type Pair = readonly [ScrollOffset.Edge, ScrollOffset.Edge]

/** A one-string stop's edges: two with a space, else a name for both, else the target's against the container's start. */
const pairOfString = (stop: string): Pair =>
  Bool.match(Str.includes(" ")(stop), {
    onTrue: (): Pair => {
      const [target = "0", container = "0"] = Str.split(stop, " ")
      return [target, container]
    },
    onFalse: (): Pair => [stop, Bool.match(isNamed(stop), { onTrue: () => stop, onFalse: () => "0" })],
  })

/** A stop's edges (Motion's `resolveOffset`): a pair as it is, a number for both, a string as {@link pairOfString} reads it. */
const pairOf: (stop: ScrollOffset.Stop) => Pair = Match.type<ScrollOffset.Stop>().pipe(
  Match.when(Match.number, (n): Pair => [n, n]),
  Match.when(Match.string, (s) => pairOfString(Str.trim(s))),
  Match.orElse((pair) => pair as Pair),
)

/** A stop as a scroll position: where the target's edge meets the container's. */
const positionOf = (stop: ScrollOffset.Stop, containerLength: number, targetLength: number, targetInset: number): number => {
  const [target, container] = pairOf(stop)
  return targetInset + edgeOffset({ edge: target, length: targetLength }) - edgeOffset({ edge: container, length: containerLength })
}

/** A scroll position and the progress it stands for. */
interface Mark {
  readonly at: number
  readonly progress: number
}

const byPosition: Order.Order<Mark> = Order.mapInput(Order.Number, (mark: Mark) => mark.at)

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Progress at `current` through the scroll positions `stops`, 0 at the first and 1 at the last,
 * evenly between them, clamped: Motion's `interpolate(stops, defaultOffset, { clamp: false })`
 * then `clamp(0, 1)`. Descending stops read as Motion's interpolate reads them, reversed.
 */
const progressThrough = (stops: ReadonlyArray<number>, current: number): number => {
  const marks = Arr.sort(
    Arr.map(stops, (at, i): Mark => ({ at, progress: i / Math.max(1, stops.length - 1) })),
    byPosition,
  )
  return Option.match(Arr.matchLeft(marks, { onEmpty: () => Option.none<Mark>(), onNonEmpty: (head) => Option.some(head) }), {
    onNone: () => 0,
    onSome: (first) => {
      const last = Option.getOrElse(Arr.last(marks), () => first)
      // Within the range: the segment `current` falls in, blended; outside it, the end it's past.
      const segment = Arr.findFirst(Arr.zip(marks, Arr.drop(marks, 1)), ([, to]) => current <= to.at)
      return Bool.match(current <= first.at, {
        onTrue: () => clamp01(first.progress),
        onFalse: () =>
          Option.match(segment, {
            onNone: () => clamp01(last.progress),
            onSome: ([from, to]) =>
              clamp01(
                from.progress +
                  (to.progress - from.progress) * Bool.match(to.at === from.at, { onTrue: () => 1, onFalse: () => (current - from.at) / (to.at - from.at) }),
              ),
          }),
      })
    },
  })
}

/**
 * Where `element` sits in `container`: Motion's `calcInset`, the offset chain up to it, SVG included.
 * A `position: static` container is no offset parent, so the chain passes it (#395): where it has
 * left the container, the container's own offset to the same parent comes off ({@link fromContainer}).
 * A chain that ends instead measures from the document, or for a fixed target the viewport, in any
 * container, as Motion's does: the page's own chain ends so, and stays as it is.
 */
const insetOf = (element: Element | null, container: Element, x: number, y: number): Point => {
  if (Bool.or(element === null, element === container)) return { x, y }
  const current = element as Element
  // Per scroll event, and per step of the chain: statements, no matcher or Option built (#618, F6).
  if (Bool.not(container.contains(current))) return fromContainer(container, current, x, y)
  if (isHTMLElement(current)) return insetOf(current.offsetParent, container, x + current.offsetLeft, y + current.offsetTop)
  if (current.tagName === "svg") {
    const parent = current.parentElement
    if (parent === null) return { x, y }
    const own = current.getBoundingClientRect()
    const box = parent.getBoundingClientRect()
    return insetOf(parent, container, x + own.left - box.left, y + own.top - box.top)
  }
  if (current instanceof SVGGraphicsElement) {
    const box = current.getBBox()
    return insetOf(current.ownerSVGElement, container, x + box.x, y + box.y)
  }
  return { x, y }
}

const isHTMLElement = (e: Element): e is HTMLElement => e instanceof HTMLElement

/**
 * `x`, `y` from `parent`, where the offset chain left `container`, made `container`'s: its own offset
 * to `parent` and its border taken off (#395). A static container's descendants measure from its
 * nearest positioned ancestor (or `<body>`, or a table cell), as it does itself, and an `offsetTop`
 * ignores its scroll, as a positioned container's descendants' do: this is the inset a positioned one
 * gives.
 */
const fromContainer = (container: Element, parent: Element, x: number, y: number): Point => {
  const own = offsetTo(container, parent, 0, 0)
  return { x: x - own.x - container.clientLeft, y: y - own.y - container.clientTop }
}

/** `element`'s offset along its offset chain up to `ancestor` (its end, for `null`). */
const offsetTo = (element: Element | null, ancestor: Element | null, x: number, y: number): Point => {
  if (element === ancestor) return { x, y }
  return Option.match(Option.filter(Option.fromNullOr(element), isHTMLElement), {
    onNone: () => ({ x, y }),
    onSome: (e) => offsetTo(e.offsetParent, ancestor, x + e.offsetLeft, y + e.offsetTop),
  })
}

/** A target's size: an SVG shape's box, else its client size (Motion's `getTargetSize`). */
const sizeOf = (target: Element): { readonly width: number; readonly height: number } =>
  Bool.match(Bool.and(target instanceof SVGGraphicsElement, target.tagName !== "svg"), {
    onTrue: () => (target as SVGGraphicsElement).getBBox(),
    onFalse: () => ({ width: target.clientWidth, height: target.clientHeight }),
  })

/** A container's progress on one axis with no target or offset: Motion's `progress(0, length, current)`, 1 for no range. */
const plainProgress = (current: number, length: number): number => Bool.match(length === 0, { onTrue: () => 1, onFalse: () => current / length })

/** What a reader measures, for `options` on `element`. Reads layout: called in events, never per frame. */
const measureOf = (element: Element, options: ScrollSource.Options): (() => ScrollSource.Scroll) => {
  const { axis = "y" } = options
  // The DOM's offset (core passes it through as the Environment's own); `All` with a target and none.
  const offset = UndefinedOr.match(options.offset as ScrollOffset.ScrollOffset | undefined, {
    onUndefined: () => ScrollOffset.All,
    onDefined: (given) => given,
  })
  const target = UndefinedOr.match(options.target as Element | undefined, { onUndefined: () => element, onDefined: (given) => given })
  // A target's progress, or an offset's through the container itself; else the plain one.
  const resolves = Bool.or(Predicate.isNotUndefined(options.target), Predicate.isNotUndefined(options.offset))
  const onAxis = (current: number): number => {
    const own = target === element
    const inset = Bool.match(own, { onTrue: (): Point => ({ x: 0, y: 0 }), onFalse: () => insetOf(target, element, 0, 0) })
    const size = Bool.match(own, {
      onTrue: () => ({ width: element.scrollWidth, height: element.scrollHeight }),
      onFalse: () => sizeOf(target),
    })
    const y = axis === "y"
    const containerLength = Bool.match(y, { onTrue: () => element.clientHeight, onFalse: () => element.clientWidth })
    const targetLength = Bool.match(y, { onTrue: () => size.height, onFalse: () => size.width })
    const targetInset = Bool.match(y, { onTrue: () => inset.y, onFalse: () => inset.x })
    return progressThrough(Arr.map(offset, (stop) => positionOf(stop, containerLength, targetLength, targetInset)), current)
  }
  return () => {
    const x = Math.abs(element.scrollLeft)
    const y = Math.abs(element.scrollTop)
    const xLength = element.scrollWidth - element.clientWidth
    const yLength = element.scrollHeight - element.clientHeight
    const resolvesOn = (on: "x" | "y"): boolean => Bool.and(resolves, axis === on)
    return {
      x: { current: x, length: xLength, progress: Bool.match(resolvesOn("x"), { onTrue: () => onAxis(x), onFalse: () => plainProgress(x, xLength) }) },
      y: { current: y, length: yLength, progress: Bool.match(resolvesOn("y"), { onTrue: () => onAxis(y), onFalse: () => plainProgress(y, yLength) }) },
    }
  }
}

/** Whether two scrolls read the same: an unchanged one isn't set, so its readers hear nothing. */
const sameScroll = (a: ScrollSource.Scroll, b: ScrollSource.Scroll): boolean =>
  Arr.every(
    [
      a.x.current === b.x.current,
      a.y.current === b.y.current,
      a.x.length === b.x.length,
      a.y.length === b.y.length,
      a.x.progress === b.x.progress,
      a.y.progress === b.y.progress,
    ],
    Boolean,
  )

/** The page's scroller: `document.scrollingElement`, else the root element. */
const pageOf = (): Element => Option.getOrElse(Option.fromNullOr(document.scrollingElement), () => document.documentElement)

/** A container's listener set, opened for its first reader. */
const open = (element: Element): Container => {
  const readers = new Set<() => void>()
  const readAll = (): void => Iter.forEach(readers, (read) => read())
  // The page's scroll is the window's event, and its range changes with the window.
  const page = Bool.or(element === document.scrollingElement, element === document.documentElement)
  const scrolls: EventTarget = Bool.match(page, { onTrue: (): EventTarget => window, onFalse: () => element })
  scrolls.addEventListener("scroll", readAll, { passive: true })
  window.addEventListener("resize", readAll)
  // Sizes (#239): a container's own box, its content's, and its readers' targets'. One observer,
  // each box counted by the reasons it's watched for (a target can be a child too).
  const sizes = new ResizeObserver(readAll)
  const watched = counted(sizes)
  // Its own resize changes a container's range (the page's is the window's), and so does its
  // content's: its direct children, kept as they come and go. A removed child resizes nothing still
  // watched, and changes the range all the same.
  const stopChildren = Bool.match(page, {
    onTrue: () => watchPage(watched, readAll),
    onFalse: () => {
      watched.observe(element)
      return watchChildren(element, watched, readAll)
    },
  })
  const container: Container = {
    readers,
    watch: (target) => {
      watched.observe(target)
      return () => watched.unobserve(target)
    },
    remove: () => {
      scrolls.removeEventListener("scroll", readAll)
      window.removeEventListener("resize", readAll)
      sizes.disconnect()
      stopChildren()
    },
  }
  return container
}

/** A reader of a container's scroll: the container's listeners held from `containers` while its Scope is open. */
const readerOf = (registry: AtomRegistry.AtomRegistry, containers: (element: Element) => Effect.Effect<Container, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (options: ScrollSource.Options = {}) {
    const element = UndefinedOr.match(options.container as Element | undefined, { onUndefined: pageOf, onDefined: (given) => given })
    const container = yield* containers(element)
    const measure = measureOf(element, options)
    let last = measure()
    // Mounted while read, not kept alive: a kept-alive Atom's node never leaves the registry.
    const atom = Atom.make(last)
    const unmount = registry.mount(atom)
    const read = (): void => {
      const next = measure()
      if (sameScroll(last, next)) return
      last = next
      registry.set(atom, next)
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => container.readers.add(read)),
      () =>
        Effect.sync(() => {
          container.readers.delete(read)
          unmount()
        }),
    )
    // A target's own size moves its offsets (#239): watched while this reader reads.
    yield* Option.match(Option.fromUndefinedOr(options.target as Element | undefined), {
      onNone: () => Effect.void,
      onSome: (target) => Effect.acquireRelease(Effect.sync(() => container.watch(target)), (unwatch) => Effect.sync(unwatch)),
    })
    return atom
  })

/**
 * The DOM's `ScrollSource`, over the Environment's `AtomRegistry`. Marked pure, so an app that never
 * builds it, with no `scroll` Feature, ships none of this module (#518).
 */
export const layer: Layer.Layer<ScrollSource.ScrollSource, never, AtomRegistry.AtomRegistry> = /*#__PURE__*/ Layer.effect(ScrollSource.ScrollSource)(
  /*#__PURE__*/ Effect.map(AtomRegistry.AtomRegistry, (registry) => ({
    // Each container's listeners while a reader holds them, the last one out removing them (#618, M7;
    // #518: `SharedSource.counted`, where Effect's `RcMap` put its code in every app). An element is its
    // own key, never hashed.
    scroll: readerOf(registry, SharedSource.counted(open, (container: Container) => Effect.sync(container.remove))),
  })),
)
