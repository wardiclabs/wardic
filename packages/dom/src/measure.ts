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
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"

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

/** {@link ScrollStyle} from an element's computed style. */
export const scrollStyleFrom = (style: CSSStyleDeclaration): ScrollStyle => ({
  scrollable: !UNSCROLLED.has(style.overflowX) || !UNSCROLLED.has(style.overflowY),
  fixed: style.position === "fixed",
})

/** {@link ScrollStyle} of `el`, uncached: one `getComputedStyle` per call. */
export const readScrollStyle = (el: Element): ScrollStyle => scrollStyleFrom(getComputedStyle(el))

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

/** The properties that move an element on screen without moving its layout (ADR-0012, *Amendment (#136)*). */
const TRANSFORM_PROPERTIES = ["transform", "translate", "scale", "rotate"] as const
type TransformProperty = (typeof TRANSFORM_PROPERTIES)[number]

/**
 * Each property's identity that isn't `none`. An element held at it keeps the containing
 * block and stacking context its transform gives it, so nothing inside lays out
 * differently while it's held.
 */
const IDENTITY: Readonly<Record<TransformProperty, string>> = {
  transform: "translate(0px)",
  translate: "0px",
  scale: "1",
  rotate: "0deg",
}

const isTransformProperty = (property: string): property is TransformProperty =>
  Arr.contains(TRANSFORM_PROPERTIES as ReadonlyArray<string>, property)

/** A transition on a transform property: `all`, or one of them by name. */
const transitionsTransform = (property: string): boolean => Bool.or(property === "all", isTransformProperty(property))

/** A CSS time (`0.3s`, `200ms`) in seconds. */
const seconds = (time: string): number =>
  Bool.match(Str.endsWith("ms")(time), { onTrue: () => Number.parseFloat(time) / 1000, onFalse: () => Number.parseFloat(time) })

/** The list a computed `transition-*` value holds, one entry per transition. */
const entries = (value: string): Array<string> => Arr.map(value.split(","), Str.trim)

/**
 * Whether `style` declares a transition that would run on one of the transform
 * properties: its name or `all`, with a combined duration (`max(duration, 0) + delay`)
 * above 0. The durations and delays repeat to the properties' length, as CSS does.
 */
const declaresTransformTransition = (style: CSSStyleDeclaration): boolean => {
  const durations = entries(style.transitionDuration)
  const delays = entries(style.transitionDelay)
  return Arr.some(entries(style.transitionProperty), (property, i) =>
    Bool.and(
      transitionsTransform(property),
      Math.max(seconds(durations[i % durations.length]), 0) + seconds(delays[i % delays.length]) > 0,
    ))
}

/** A computed transform property that moves its element: set, and not `none` (`""` is unsupported, or no style). */
const isMoving = (value: string): boolean => Bool.and(Str.isNonEmpty(value), value !== "none")

/** What the Measure pass needs from an element's style to hold its transform. */
export interface TransformStyle {
  /** The transform properties that aren't `none`. Empty: nothing moves it. */
  readonly moved: ReadonlyArray<TransformProperty>
  /** Whether a CSS transition is declared on one of them. */
  readonly transitioned: boolean
}

/**
 * Whether one of `style`'s transform properties moves its element. Read through the
 * properties' accessors, which cost less than `getPropertyValue` (0.57 against 0.70 µs for
 * the four in Chromium 147), and nothing is allocated.
 */
const movesAny = (style: CSSStyleDeclaration): boolean =>
  Bool.or(Bool.or(isMoving(style.transform), isMoving(style.translate)), Bool.or(isMoving(style.scale), isMoving(style.rotate)))

/**
 * {@link TransformStyle} from an element's computed style. `getComputedStyle` returns a
 * live declaration, so a caller that keeps one per element reads the current values each
 * time without calling it again.
 */
export const transformStyleFrom = (style: CSSStyleDeclaration): TransformStyle => {
  // Most elements carry none: they cost the four reads, and nothing else.
  if (Bool.not(movesAny(style))) return UNMOVED
  return {
    moved: Arr.filter(TRANSFORM_PROPERTIES, (property) => isMoving(style[property])),
    transitioned: declaresTransformTransition(style),
  }
}

/** The answer for an element no transform moves, shared. */
const UNMOVED: TransformStyle = { moved: [], transitioned: false }

/**
 * Whether a CSS transition is running on one of `el`'s transform properties. Holding it
 * would cancel or restart that transition, so the pass leaves it as it is: its offset
 * stays in the box (the documented limit).
 */
export const transitionRunning = (el: Element): boolean =>
  Arr.some(el.getAnimations(), (animation) => Bool.and(animation instanceof CSSTransition, isTransformProperty((animation as CSSTransition).transitionProperty)))

/** An element the pass can hold: one with an inline style. */
export type Holdable = Element & ElementCSSInlineStyle

/** Whether `el` has an inline style the pass can hold its transform through. */
export const isHoldable = (el: Element): el is Holdable => Predicate.hasProperty(el, "style")

/** An element held at its transform's identity for a read, and what to put back. */
export interface TransformHold {
  readonly element: Holdable
  /** Each held property's own inline value and priority (`""` for none). */
  readonly saved: ReadonlyArray<readonly [TransformProperty, string, string]>
  /** The inline `transition-property` and priority, when the hold turned transitions off. */
  readonly transition: Option.Option<readonly [string, string]>
}

/** Put an inline property back as it was: removed when it had no inline value. */
const restoreProperty = (inline: CSSStyleDeclaration, property: string, value: string, priority: string): void =>
  Bool.match(Str.isEmpty(value), {
    onTrue: () => {
      inline.removeProperty(property)
    },
    onFalse: () => inline.setProperty(property, value, priority),
  })

/**
 * Hold `el`'s transform properties at their identity (ADR-0012, *Amendment (#136)*):
 * inline and `!important`, so a stylesheet rule, a CSS animation and a Web Animation
 * all give way. An element with a transition declared on one of them also gets
 * `transition-property: none` for the hold, so it starts none.
 */
export const holdTransform = (el: Holdable, style: TransformStyle): TransformHold => {
  const inline = el.style
  const saved = Arr.map(style.moved, (property) => [property, inline.getPropertyValue(property), inline.getPropertyPriority(property)] as const)
  const transition = Bool.match(style.transitioned, {
    onFalse: () => Option.none<readonly [string, string]>(),
    onTrue: () => Option.some([inline.getPropertyValue("transition-property"), inline.getPropertyPriority("transition-property")] as const),
  })
  if (Option.isSome(transition)) inline.setProperty("transition-property", "none", "important")
  Arr.forEach(style.moved, (property) => inline.setProperty(property, IDENTITY[property], "important"))
  return { element: el, saved, transition }
}

/**
 * Put back what {@link holdTransform} replaced. The elements whose transitions it turned
 * off get their transform back first, then a style read, then their transition, so the
 * return from identity starts no transition either.
 */
export const releaseTransforms = (holds: ReadonlyArray<TransformHold>): void => {
  Arr.forEach(holds, (hold) => Arr.forEach(hold.saved, ([property, value, priority]) => restoreProperty(hold.element.style, property, value, priority)))
  const transitioned = Arr.filter(holds, (hold) => Option.isSome(hold.transition))
  Arr.forEach(transitioned, (hold) => getComputedStyle(hold.element).getPropertyValue("transform"))
  Arr.forEach(transitioned, (hold) =>
    Option.match(hold.transition, {
      onNone: constVoid,
      onSome: ([value, priority]) => restoreProperty(hold.element.style, "transition-property", value, priority),
    }))
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
