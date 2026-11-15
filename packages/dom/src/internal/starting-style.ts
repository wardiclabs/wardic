/**
 * The Starting style (ADR-0003, ADR-0021): an element's style before its first Frame,
 * `project(resolveInitial(config))`, computed purely with no runtime. It is the server's
 * markup, the style the hydration render keeps, and the animation's `from`. And the style
 * after the first Frame, the fallback: the user's, without the keys Wardic holds (ADR-0034).
 *
 * Framework-free, so every binding renders it the same way on a server and on the client
 * (the thin-bindings rule): a binding reads its config, calls these, and casts the style to
 * its own JSX type. The merge `over` does moved here from @wardic/solid with its behaviour
 * unchanged; `over` and `without` are `dual` (#132's PR 3, ADR-0041 decision 5). Tier 2, for
 * binding authors.
 *
 * Observability: pure and per element, so quiet (no span, no log).
 */
// #672: its pure half (`toValues`, `resolveInitial`, the Keyframes' stops) is core's
// `unstable/Stops` now, which `Style` re-exports.
import * as Arr from "effect/Array"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import { project } from "./renderer.ts"
import { dashCase, type SplitPatch, splitPatchForTag } from "./svg.ts"

/**
 * A CSS declaration list (`"color: red; background: url(a;b)"`) as `{ property: value }`.
 * A `;` inside parentheses or quotes doesn't end a declaration. Internal (not in the
 * package index): `own-values.ts`'s style lookup shares it.
 */
export const parseCssText = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  // A counted scan over UTF-16 units, as `slice` counts: a `;` outside parentheses and quotes ends a
  // declaration, and a backslash in a quote escapes the next unit (#618, F6: a reduce built a scan
  // state and a matcher each character, 15-25 times as slow).
  let depth = 0
  let quote = 0
  let escaped = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (escaped) {
      escaped = false
      continue
    }
    if (quote !== 0) {
      if (c === BACKSLASH) escaped = true
      if (c === quote) quote = 0
      continue
    }
    if (c === DOUBLE_QUOTE || c === SINGLE_QUOTE) quote = c
    if (c === OPEN) depth++
    if (c === CLOSE) depth = Math.max(0, depth - 1)
    if (c === SEMICOLON && depth === 0) {
      takeDeclaration(text, start, i, out)
      start = i + 1
    }
  }
  takeDeclaration(text, start, text.length, out)
  return out
}

const BACKSLASH = 92
const DOUBLE_QUOTE = 34
const SINGLE_QUOTE = 39
const OPEN = 40
const CLOSE = 41
const SEMICOLON = 59

/** The declaration in `text` from `start` to `end` into `out`: its property and value, trimmed, when it has both. */
const takeDeclaration = (text: string, start: number, end: number, out: Record<string, string>): void => {
  const declaration = text.slice(start, end)
  const colon = declaration.indexOf(":")
  if (colon <= 0) return
  const key = declaration.slice(0, colon).trim()
  const value = declaration.slice(colon + 1).trim()
  if (key !== "" && value !== "") out[key] = value
}

/** Where {@link parseCssText} is: the parentheses open, the string's quote, a backslash just read in it, the declaration's start. */
/**
 * A style as a binding hands it over: a record of CSS properties, CSS text (`"color: red"`, which
 * JSX allows), or none.
 */
export type StyleInput = object | string | undefined

/** A style record: CSS properties to their values. */
export type StyleRecord = Readonly<Record<string, unknown>>

/** A style given as CSS text, parsed; a record as it is. */
const recordOf = (input: object | string): StyleRecord => {
  // Per element at mount (#540): statements.
  if (Predicate.isString(input)) return parseCssText(input)
  return input as StyleRecord
}

/** A style given as CSS text, parsed; a record as it is; none, an empty record. */
const recordOfInput = (input: StyleInput): StyleRecord => {
  // Per element at mount (#540): statements.
  if (Predicate.isUndefined(input)) return {}
  return recordOf(input)
}

const setsKey =
  (key: string): Predicate.Predicate<StyleRecord> =>
  (style) =>
    Predicate.isNotUndefined(style[key])

/**
 * Whether a style sets `user-select` and not `-webkit-user-select`, and the reverse. Chromium has
 * one property under both names, so a value set under one is the value for both.
 */
const setsOnlyUserSelect = Predicate.and(setsKey("user-select"), Predicate.not(setsKey("-webkit-user-select")))
const setsOnlyWebkitUserSelect = Predicate.and(setsKey("-webkit-user-select"), Predicate.not(setsKey("user-select")))

/** `self` laid over `that`: both present. */
const layered = (self: StyleRecord, that: StyleRecord): StyleRecord => {
  const merged: Record<string, unknown> = { ...that, ...self }
  // `self`'s value for either name is the value for both, or `that`'s left on the other wins.
  if (setsOnlyUserSelect(self)) merged["-webkit-user-select"] = self["user-select"]
  if (setsOnlyWebkitUserSelect(self)) merged["user-select"] = self["-webkit-user-select"]
  return merged
}

/**
 * `self` laid over `that`: `self`'s keys win, and `that`'s others stay. A chain reads from the top layer
 * down: an element's style is its drag defaults, under its base, under the app's, under what Wardic
 * animates. A side given as CSS text is parsed, so a framework never writes `cssText` over the keys
 * Wardic holds, and a side that's `undefined` leaves the other as it is, the same object. Whatever `self`
 * sets for `user-select` or `-webkit-user-select` it sets for both: one property in Chromium.
 *
 * @example
 * // Before the first commit: the starting style over the app's, over a base and a drag element's defaults.
 * pipe(starting, Style.over(user), Style.over(base), Style.over(Style.dragDefaults("x")))
 */
// `dual`, `self` first (ADR-0041, decision 5). The layering: ADR-0019 *Amendment (Reorder)*.
export const over: {
  (that: StyleInput): (self: StyleInput) => StyleRecord
  (self: StyleInput, that: StyleInput): StyleRecord
} = dual(2, (self: StyleInput, that: StyleInput): StyleRecord => {
  // Per element at mount (#540): statements.
  if (Predicate.isUndefined(that)) return recordOfInput(self)
  if (Predicate.isUndefined(self)) return recordOf(that)
  return layered(recordOf(self), recordOf(that))
})

/** Whether `key`, a CSS property, is one of the gate's held patch keys: by its name, or its name dash-cased. */
const isHeld = (held: ReadonlyArray<string>, key: string): boolean => {
  // Per element at mount (#540): a loop.
  for (const patchKey of held) {
    if (patchKey === key || dashCase(patchKey) === key) return true
  }
  return false
}

/**
 * `self` without the keys the flush gate holds on the element (`held`, by patch key, matched by CSS
 * property): the style once its first frame is committed. Wardic writes those while it drives them, and
 * the app's `style` is their fallback, so a key the gate lets go of comes back.
 *
 * @example
 * pipe(user, Style.over(base), Style.without(held))
 */
// ADR-0034.
export const without: {
  (held: ReadonlyArray<string>): (self: StyleInput) => StyleRecord
  (self: StyleInput, held: ReadonlyArray<string>): StyleRecord
} = dual(2, (self: StyleInput, held: ReadonlyArray<string>): StyleRecord => {
  // Per element at mount (#540): a loop.
  const record = recordOfInput(self)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (!isHeld(held, key)) out[key] = record[key]
  }
  return out
})

/**
 * Whether the keys the flush gate holds, changing from `prev` to `next`, change `self`'s `without`:
 * whether a key taken or let go of is one `self` sets, by its name or its name dash-cased. Most changes
 * touch none, and a binding then leaves its `style` alone.
 */
// ADR-0034.
export const heldTouches: {
  (prev: ReadonlyArray<string>, next: ReadonlyArray<string>): (self: StyleRecord) => boolean
  (self: StyleRecord, prev: ReadonlyArray<string>, next: ReadonlyArray<string>): boolean
} = dual(3, (self: StyleRecord, prev: ReadonlyArray<string>, next: ReadonlyArray<string>): boolean =>
  Arr.some([...Arr.difference(prev, next), ...Arr.difference(next, prev)], (key) =>
    Arr.some([key, dashCase(key)], (name) => Object.hasOwn(self, name)),
  ),
)

/**
 * The starting style of a `tag` element starting from `values`: projected as the renderer projects a
 * Frame, then split by tag, an SVG element's keys inside an `<svg>` as attributes, and the rest as style.
 * `undefined` is an HTML element, as for a spread that doesn't know its tag.
 */
// The Starting style; routed by tag (ADR-0014). The spread: a `createWard` spread.
export const startingStyle = (tag: string | undefined, values: Readonly<Record<string, unknown>>): SplitPatch =>
  splitPatchForTag(tag, project(values))
