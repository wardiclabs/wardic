/**
 * **Measured pairs** (#430, CONTEXT.md; Motion's `DOMKeyframesResolver`, `.reference/motion` at
 * `16c6122`): a positional key whose start and target differ in type (`"auto"`, `"50%"` against a
 * length in px, a `calc()` on one side) is measured in px at both ends, its leg runs between them,
 * and it lands on its target as given.
 *
 * - **Which keys:** `width`, `height`, `top`, `left`, `right`, `bottom`, and the translates `x`, `y`,
 *   `translateX`, `translateY`: Motion's `positionalKeys` with a measurement (`positionalValues`).
 * - **When** (#430's Q2): every pair a task asks for is measured in one batch, in a microtask at the
 *   end of that task, before its paint (ADR-0018's timing): each start read, each target written
 *   inline, the page laid out once, each target read, every style restored. Motion's
 *   `measureAllKeyframes`. Nothing paints the target, and a `ResizeObserver` never reports it.
 * - **An end already in px** (a number, a px length) is taken as given: only `auto`, a percentage, a
 *   `calc()` or another unit is read from the layout.
 * - **The reads:** a size from the computed style, which a transform doesn't change, else from the
 *   box (an element with none of its own, inline: Motion's `measureDimension`); an inset from the
 *   computed style, else, for `right` and `bottom`, Motion's sum from `top` or `left` and the box,
 *   read with the element's transform off; a translate from the computed transform's matrix.
 *
 * A binding asks with {@link measure} at a Retarget, which returns each pair as asked
 * ({@link Requested}), and its leg reads each one {@link measured} at its first step, a tick after the
 * batch: a new record with its px, none if the batch couldn't read it.
 */
import * as Interpolator from "@wardic/core/Interpolator"
import type * as Values from "@wardic/core/Values"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { project } from "./renderer.ts"

/** The keys a Measured pair can be on (Motion's positional keys with a measurement). */
const SIZES: ReadonlySet<string> = new Set(["width", "height"])
const INSETS: ReadonlySet<string> = new Set(["top", "left", "right", "bottom"])
const TRANSLATES: ReadonlySet<string> = new Set(["x", "y", "translateX", "translateY"])

/** Every key a Measured pair can be on: one lookup per key, per Retarget (#460). */
const MEASURABLE: ReadonlySet<string> = new Set([...SIZES, ...INSETS, ...TRANSLATES])

/** Whether `key` can be a Measured pair. */
const isMeasurable = (key: string): boolean => MEASURABLE.has(key)

/**
 * A value's type, as a Measured pair compares them: a number or a px length is `px`; `auto`; a
 * `calc()` or `var()`; any other unit; `undefined` for what isn't a length. Per key, per Retarget: a
 * number, nearly every translate's, makes nothing.
 */
const kindOf = (value: number | string): string | undefined => {
  if (Predicate.isNumber(value)) return "px"
  const text = value.trim()
  if (text === "auto") return "auto"
  if (/^(calc|var|min|max|clamp)\(/.test(text)) return "calc"
  return Option.getOrUndefined(Option.map(Interpolator.unitOf(text), (unit) => Bool.match(Bool.or(unit === "", unit === "px"), { onTrue: () => "px", onFalse: () => unit })))
}

/**
 * Whether `key` from `from` to `to` needs measuring, a Measured pair: a key that can be measured, whose
 * two ends are lengths, `auto` or a `calc()`, of different types. Two of one type blend as ever.
 */
// #430; `needs`, not a type guard's `is…` name (#618, A3).
export const needs = (key: string, from: number | string, to: number | string): boolean => {
  if (Bool.not(isMeasurable(key))) return false
  const a = kindOf(from)
  if (Predicate.isUndefined(a)) return false
  const b = kindOf(to)
  if (Predicate.isUndefined(b)) return false
  return a !== b
}

/** One Measured pair as asked for: its key, and its ends as given. */
// #430; split from the measured one (#618, A1): the batch wrote its px into the asker's record.
export interface Requested {
  /** The key. */
  readonly key: string
  /** Its start, as given. */
  readonly from: number | string
  /** Its target, as given. */
  readonly to: number | string
}

/** One Measured pair its batch has read: as asked, with each end in px. */
export interface Measured extends Requested {
  /** Its start in px. */
  readonly fromPx: number
  /** Its target in px. */
  readonly toPx: number
}

/** A pair as its batch reads it: each end's px so far. */
interface Slot {
  readonly pair: Requested
  fromPx: number | undefined
  toPx: number | undefined
}

/** An element's pairs in a batch, and the values it draws now, which a translate's transform is built from. */
interface Request {
  readonly element: HTMLElement
  readonly slots: ReadonlyArray<Slot>
  readonly values: Values.Values
}

// Module state (#460, Q7): each pair its batch has read, by the pair as asked, kept as long as its asker
// keeps that pair.
const read = new WeakMap<Requested, Measured>()

/**
 * `pair` with its px, once its end-of-task batch has read both its ends: none before that batch, and
 * none if it couldn't read one, which the animation takes as a switch.
 */
// #618 (A1).
export const measured = (pair: Requested): Option.Option<Measured> => Option.fromUndefinedOr(read.get(pair))

/** The pairs this task asked for, measured at its end. */
// Module state (#460, Q7): the page's one batch, so every provider's pairs share one read pass a task.
let queued: Array<Request> = []
// Module state (#460, Q7): the page's one end-of-task batch across providers.
let scheduled = false

/**
 * Measures `pairs` on `element` at the end of this task, with every other element's in the same batch:
 * each pair, as asked, {@link measured} before the next tick. `values` are what the element draws now,
 * its other transforms among them.
 */
// #430's Q2.
export const measure = (
  element: HTMLElement,
  pairs: Readonly<Record<string, { readonly from: number | string; readonly to: number | string }>>,
  values: Values.Values,
): Readonly<Record<string, Requested>> => {
  const made = Rec.map(pairs, ({ from, to }, key): Requested => ({ key, from, to }))
  queued.push({ element, slots: Arr.map(Rec.values(made), (pair): Slot => ({ pair, fromPx: undefined, toPx: undefined })), values })
  if (Bool.not(scheduled)) {
    scheduled = true
    queueMicrotask(flush)
  }
  return made
}

/** A length's CSS text, as a style property takes it: a number in px. */
const cssOf = (value: number | string): string => Bool.match(Predicate.isNumber(value), { onTrue: () => `${value as number}px`, onFalse: () => value as string })

/**
 * An end already in px (#430): a number, or a px length, taken as given, not read from the layout.
 * So an explicit first stop (`[0, "auto"]`) starts at it, where Motion's `measureInitialState` reads
 * the element over it, and a target in px is never written to be read.
 */
const givenPx = (value: number | string): number | undefined => {
  if (kindOf(value) !== "px") return undefined
  if (Predicate.isNumber(value)) return value
  return Option.getOrUndefined(pxOf(value))
}

/** A number read from CSS text, `None` when it isn't one (`auto`). */
const pxOf = (text: string): Option.Option<number> => Option.liftPredicate(Number.parseFloat(text), Number.isFinite)

/** A size read from the box, as Motion's `measureDimension`: the border box, less the padding for a content box. */
const sizeFromBox = (element: HTMLElement, style: CSSStyleDeclaration, key: string): number => {
  const box = element.getBoundingClientRect()
  const size = Bool.match(key === "width", { onTrue: () => box.width, onFalse: () => box.height })
  if (style.boxSizing === "border-box") return size
  const [start, end] = Bool.match(key === "width", {
    onTrue: () => [style.paddingLeft, style.paddingRight] as const,
    onFalse: () => [style.paddingTop, style.paddingBottom] as const,
  })
  return size - Option.getOrElse(pxOf(start), () => 0) - Option.getOrElse(pxOf(end), () => 0)
}

/** An inset Motion reads from the box (`right`, `bottom`): its opposite inset and the box's size, the element's transform off. */
const insetFromBox = (element: HTMLElement, style: CSSStyleDeclaration, key: string): number => {
  const transform = element.style.transform
  element.style.transform = "none"
  const box = element.getBoundingClientRect()
  element.style.transform = transform
  const [opposite, size] = Bool.match(key === "right", { onTrue: () => [style.left, box.width] as const, onFalse: () => [style.top, box.height] as const })
  return Option.getOrElse(pxOf(opposite), () => 0) + size
}

/** A translate read from the computed transform's matrix. */
const translateOf = (style: CSSStyleDeclaration, key: string): number => {
  const matrix = new DOMMatrix(Bool.match(style.transform === "none", { onTrue: () => "matrix(1, 0, 0, 1, 0, 0)", onFalse: () => style.transform }))
  return Bool.match(Bool.or(key === "x", key === "translateX"), { onTrue: () => matrix.m41, onFalse: () => matrix.m42 })
}

/** `key`'s value in px as `element` lays out now. */
const readPx = (element: HTMLElement, style: CSSStyleDeclaration, key: string): number => {
  if (TRANSLATES.has(key)) return translateOf(style, key)
  const read = pxOf(style.getPropertyValue(key))
  if (Option.isSome(read)) return read.value
  if (SIZES.has(key)) return sizeFromBox(element, style, key)
  if (Bool.or(key === "right", key === "bottom")) return insetFromBox(element, style, key)
  return 0
}

/** An inline property as it was before a batch wrote its target, to put back. */
interface Saved {
  readonly element: HTMLElement
  readonly property: string
  readonly value: string
  readonly priority: string
}

/** An inline property as it is now, to put back. */
const savedOf = (element: HTMLElement, property: string): Saved => ({ element, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) })

/**
 * Write `pairs`' translates at their `end` through the element's whole transform, keeping what was
 * there: the browser lays out any unit, `-100%` included (#594).
 */
const writeTranslates = (request: Request, slots: ReadonlyArray<Slot>, end: "from" | "to"): ReadonlyArray<Saved> => {
  if (slots.length === 0) return []
  const { element, values } = request
  const saved = savedOf(element, "transform")
  const transform = project({ ...values, ...Rec.fromEntries(Arr.map(slots, ({ pair }) => [pair.key, pair[end]] as const)) })["transform"]
  element.style.setProperty("transform", UndefinedOr.match(transform as string | undefined, { onUndefined: () => "none", onDefined: String }))
  return [saved]
}

/** Write each pair's target inline on its element, keeping what was there; a translate through the element's whole transform. */
const writeTargets = (request: Request): ReadonlyArray<Saved> => {
  const unread = Arr.filter(request.slots, (slot) => Predicate.isUndefined(slot.toPx))
  const saved: Array<Saved> = [...writeTranslates(request, Arr.filter(unread, (slot) => TRANSLATES.has(slot.pair.key)), "to")]
  Arr.forEach(unread, ({ pair }) => {
    if (TRANSLATES.has(pair.key)) return
    saved.push(savedOf(request.element, pair.key))
    request.element.style.setProperty(pair.key, cssOf(pair.to))
  })
  return saved
}

/**
 * Write each translate pair's start not in px, as a target is (#594): a layout element's transform at
 * this moment is its projection's, or held off for its Measure pass, so reading it as it is gave 0.
 */
const writeTranslateStarts = (request: Request): ReadonlyArray<Saved> =>
  writeTranslates(request, Arr.filter(request.slots, (slot) => Bool.and(TRANSLATES.has(slot.pair.key), Predicate.isUndefined(slot.fromPx))), "from")

/** Put back what {@link writeTargets} replaced. */
const restore = (saved: ReadonlyArray<Saved>): void =>
  Arr.forEach(saved, ({ element, property, value, priority }) =>
    Bool.match(value === "", {
      onTrue: () => void element.style.removeProperty(property),
      onFalse: () => element.style.setProperty(property, value, priority),
    }))

/**
 * The batch (#430's Q2): every start read, every target written, every target read, every style
 * restored, so the page is laid out once for all of them and paints none. A page scrolled by a target
 * (a height growing above the view) is scrolled back, as Motion's `suspendedScrollY`.
 */
const flush = (): void => {
  const batch = queued
  queued = []
  scheduled = false
  const styles = Arr.map(batch, ({ element }) => getComputedStyle(element))
  // Each end in px as given.
  Arr.forEach(batch, (request) => Arr.forEach(request.slots, (slot) => {
    slot.toPx = givenPx(slot.pair.to)
    slot.fromPx = givenPx(slot.pair.from)
  }))
  // WRITE, READ, WRITE: each translate's start not in px, written alone and read (#594).
  const starts = Arr.flatMap(batch, writeTranslateStarts)
  if (Arr.isArrayNonEmpty(starts)) {
    try {
      Arr.forEach(batch, (request, i) => Arr.forEach(request.slots, (slot) => {
        if (Bool.and(TRANSLATES.has(slot.pair.key), Predicate.isUndefined(slot.fromPx))) slot.fromPx = readPx(request.element, UndefinedOr.getOrThrow(styles[i]), slot.pair.key)
      }))
    } finally {
      restore(starts)
    }
  }
  // READ: each other start not already in px, as the element lays out now.
  Arr.forEach(batch, (request, i) => Arr.forEach(request.slots, (slot) => {
    if (Predicate.isUndefined(slot.fromPx)) slot.fromPx = readPx(request.element, UndefinedOr.getOrThrow(styles[i]), slot.pair.key)
  }))
  const scrollY = globalThis.scrollY
  // WRITE: each target, inline.
  const saved = Arr.flatMap(batch, writeTargets)
  try {
    // READ: each target not already in px, laid out once.
    Arr.forEach(batch, (request, i) => Arr.forEach(request.slots, (slot) => {
      if (Predicate.isUndefined(slot.toPx)) slot.toPx = readPx(request.element, UndefinedOr.getOrThrow(styles[i]), slot.pair.key)
    }))
  } finally {
    // WRITE: every style as it was.
    restore(saved)
    if (globalThis.scrollY !== scrollY) globalThis.scrollTo(globalThis.scrollX, scrollY)
  }
  // Each pair read at both ends, as a record of its own.
  Arr.forEach(batch, (request) => Arr.forEach(request.slots, ({ pair, fromPx, toPx }) => {
    if (Predicate.isUndefined(fromPx)) return
    if (Predicate.isUndefined(toPx)) return
    if (Bool.and(Number.isFinite(fromPx), Number.isFinite(toPx))) read.set(pair, { ...pair, fromPx, toPx })
  }))
}
