/**
 * The Starting style (ADR-0003, ADR-0021): an element's style before its first Frame,
 * `project(resolveInitial(config))`, computed purely with no runtime. It is the server's
 * markup, the style the hydration render keeps, and the animation's `from`. And the style
 * after the first Frame, the fallback: the user's, without the keys Wardic holds (ADR-0034).
 *
 * Framework-free, so every binding renders it the same way on a server and on the client
 * (the thin-bindings rule): a binding reads its config, calls these, and casts the style to
 * its own JSX type. `toValues`, `resolveInitial` and `mergeStyle` moved here from
 * @wardic/solid with their behaviour unchanged. Tier 2, for binding authors.
 *
 * Observability: pure and per element, so quiet (no span, no log).
 */
import type * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { dual } from "effect/Function"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { DragDefaultStyle } from "./drag-defaults.ts"
import { project } from "./renderer.ts"
import { dashCase, type SplitPatch, splitPatchForTag } from "./svg.ts"

/**
 * A values map with only the keys an animation can take: numbers and strings (custom
 * properties included). `undefined` and anything else drop out, so the engine never sees
 * them.
 */
export const toValues = (v: object | undefined): Values.Values => {
  const out: Record<string, number | string> = {}
  if (v) {
    for (const k in v) {
      const val = (v as Record<string, unknown>)[k]
      if (val !== undefined && (typeof val === "number" || typeof val === "string")) out[k] = val
    }
  }
  return out
}

/**
 * The part of an element's config its Starting style is resolved from. Values maps are
 * typed `object` so a binding's own value types (interfaces) fit as they are.
 */
export interface InitialConfig {
  /**
   * A values map used as is, the name of a `variants` entry, or `false`: start at
   * {@link animate} (#134, Motion's `initial={false}`).
   */
  readonly initial?: object | string | false | undefined
  /** What `initial: false` starts at: a values map, or the name of a `variants` entry. */
  readonly animate?: object | string | undefined
  readonly variants?: Readonly<Record<string, object | undefined>> | undefined
}

/** A values map, or the `variants` entry a name names (an unknown name is empty), or nothing. */
const entryOf = (entry: object | string | undefined, variants: InitialConfig["variants"]): Values.Values => {
  if (entry === undefined) return {}
  if (typeof entry === "string") return toValues(variants?.[entry])
  return toValues(entry)
}

/**
 * The values an element starts from: its `initial` map, or the `variants` entry its
 * `initial` names (an unknown name is empty), or nothing. With `initial: false`, its
 * `animate`, resolved the same way, so it starts at its target and nothing animates at
 * mount (#134, Motion's). Read once, at setup: the Starting style is a seed, never a
 * live target.
 */
export const resolveInitial = (config: InitialConfig): Values.Values => {
  const initial = config.initial
  if (initial === false) return entryOf(config.animate, config.variants)
  return entryOf(initial, config.variants)
}

/**
 * A CSS declaration list (`"color: red; background: url(a;b)"`) as `{ property: value }`.
 * A `;` inside parentheses or quotes doesn't end a declaration. Internal (not in the
 * package index): `own-values.ts`'s style lookup shares it.
 */
export const parseCssText = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  let depth = 0
  let quote: string | undefined
  let start = 0
  const take = (end: number): void => {
    const declaration = text.slice(start, end)
    const colon = declaration.indexOf(":")
    if (colon > 0) {
      const key = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()
      if (key !== "" && value !== "") out[key] = value
    }
    start = end + 1
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote !== undefined) {
      if (c === "\\") i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") quote = c
    else if (c === "(") depth++
    else if (c === ")") depth = Math.max(0, depth - 1)
    else if (c === ";" && depth === 0) take(i)
  }
  take(text.length)
  return out
}

/**
 * An element's style: the user's static style as the base, its animated keys on top, over
 * a drag element's defaults and a component's base style (ADR-0019 *Amendment
 * (Reorder)*): defaults < base < user < animated. With neither defaults nor base, the user's
 * style plus the animated keys, or the animated patch itself when the user has none. A
 * user style given as CSS text (`"color: red"`, which JSX allows) is parsed first.
 */
export const mergeStyle = (
  user: object | string | undefined,
  animated: Renderer.Patch,
  defaults?: DragDefaultStyle,
  base?: object,
): Record<string, unknown> => {
  const users = (typeof user === "string" ? parseCssText(user) : user) as Readonly<Record<string, unknown>> | undefined
  if (defaults === undefined && base === undefined) return users !== undefined ? { ...users, ...animated } : animated
  const merged: Record<string, unknown> = { ...defaults, ...base, ...users, ...animated }
  // `user-select` and `-webkit-user-select` are one property in Chromium: the user's
  // value for either is the value for both, or the default left on the other wins.
  if (users !== undefined) {
    if (users["user-select"] !== undefined && users["-webkit-user-select"] === undefined) {
      merged["-webkit-user-select"] = users["user-select"]
    } else if (users["-webkit-user-select"] !== undefined && users["user-select"] === undefined) {
      merged["user-select"] = users["-webkit-user-select"]
    }
  }
  return merged
}

/**
 * An element's style once its first frame is committed (ADR-0034): the user's style over a
 * drag element's defaults and a component's base style, merged as {@link mergeStyle} merges
 * them, without the keys the flush gate holds on the element (`held`, by patch key). Wardic
 * writes those while it drives them, and `style` is their fallback: a key the gate lets go of
 * comes back. A user style given as CSS text is parsed, so a framework never writes `cssText`
 * over the keys the gate holds.
 */
export const fallbackStyle = (
  user: object | string | undefined,
  held: ReadonlyArray<string>,
  defaults?: DragDefaultStyle,
  base?: object,
): Record<string, unknown> => {
  const merged = mergeStyle(user, {}, defaults, base)
  return Rec.filter(merged, (_, key) => !Arr.some(held, (patchKey) => patchKey === key || dashCase(patchKey) === key))
}

/**
 * Whether the keys the flush gate holds, changing from `prev` to `next`, change an element's
 * {@link fallbackStyle}: whether a key that was taken or let go of is one `style` sets
 * (`style` as {@link mergeStyle} merges it, keyed by CSS property). Most changes touch none, and
 * a binding then leaves its `style` alone (ADR-0034).
 */
export const heldTouchesPositional = (
  prev: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
  style: Readonly<Record<string, unknown>>,
): boolean => {
  const sets = (key: string): boolean => Object.hasOwn(style, key) || Object.hasOwn(style, dashCase(key))
  const leftBehind = (from: ReadonlyArray<string>, to: ReadonlyArray<string>): boolean =>
    Arr.some(from, (key) => !Arr.contains(to, key) && sets(key))
  return leftBehind(prev, next) || leftBehind(next, prev)
}

/**
 * A style as a binding hands it over: a record of CSS properties, CSS text (`"color: red"`, which
 * JSX allows), or none.
 */
export type StyleInput = object | string | undefined

/** A style record: CSS properties to their values. */
export type StyleRecord = Readonly<Record<string, unknown>>

/** A style given as CSS text, parsed; a record as it is. */
const recordOf: (input: object | string) => StyleRecord = Match.type<object | string>().pipe(
  Match.when(Predicate.isString, parseCssText),
  Match.orElse((record) => record as StyleRecord),
)

/** A style given as CSS text, parsed; a record as it is; none, an empty record. */
const recordOfInput = (input: StyleInput): StyleRecord =>
  UndefinedOr.match(input, { onUndefined: (): StyleRecord => ({}), onDefined: recordOf })

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
 * `self` laid over `that`: `self`'s keys win, and `that`'s others stay (ADR-0041, decision 5). A
 * chain reads from the top layer down:
 *
 * ```ts
 * // before the first commit: the Starting style over the user's, over a base and a drag element's defaults
 * pipe(starting, Style.over(user), Style.over(base), Style.over(defaults))
 * ```
 *
 * A side given as CSS text is parsed, so a framework never writes `cssText` over the keys the
 * flush gate holds. A side that's `undefined` leaves the other as it is, the same object. Whatever
 * `self` sets for `user-select` or `-webkit-user-select` it sets for both, over `that`: one
 * property in Chromium.
 */
export const over: {
  (that: StyleInput): (self: StyleInput) => StyleRecord
  (self: StyleInput, that: StyleInput): StyleRecord
} = dual(2, (self: StyleInput, that: StyleInput): StyleRecord =>
  UndefinedOr.match(that, {
    onUndefined: () => recordOfInput(self),
    onDefined: (below) =>
      UndefinedOr.match(self, {
        onUndefined: () => recordOf(below),
        onDefined: (above) => layered(recordOf(above), recordOf(below)),
      }),
  }),
)

/** Whether `key`, a CSS property, is one of the gate's held patch keys: by its name, or its name dash-cased. */
const isHeld = (held: ReadonlyArray<string>, key: string): boolean =>
  Arr.some(held, (patchKey) => Arr.contains([patchKey, dashCase(patchKey)], key))

/**
 * `self` without the keys the flush gate holds on the element (`held`, by patch key, matched by
 * CSS property): the style once its first frame is committed (ADR-0034). Wardic writes those
 * while it drives them, and `style` is their fallback, so a key the gate lets go of comes back.
 *
 * ```ts
 * pipe(user, Style.over(base), Style.over(defaults), Style.without(held))
 * ```
 */
export const without: {
  (held: ReadonlyArray<string>): (self: StyleInput) => StyleRecord
  (self: StyleInput, held: ReadonlyArray<string>): StyleRecord
} = dual(2, (self: StyleInput, held: ReadonlyArray<string>): StyleRecord =>
  Rec.filter(recordOfInput(self), (_, key) => Bool.not(isHeld(held, key))),
)

/**
 * Whether the keys the flush gate holds, changing from `prev` to `next`, change `self`'s
 * {@link without}: whether a key that was taken or let go of is one `self` sets, by its name or
 * its name dash-cased. Most changes touch none, and a binding then leaves its `style` alone
 * (ADR-0034).
 */
export const heldTouches: {
  (prev: ReadonlyArray<string>, next: ReadonlyArray<string>): (self: StyleRecord) => boolean
  (self: StyleRecord, prev: ReadonlyArray<string>, next: ReadonlyArray<string>): boolean
} = dual(3, (self: StyleRecord, prev: ReadonlyArray<string>, next: ReadonlyArray<string>): boolean =>
  Arr.some([...Arr.difference(prev, next), ...Arr.difference(next, prev)], (key) =>
    Arr.some([key, dashCase(key)], (name) => Object.hasOwn(self, name)),
  ),
)

/**
 * The Starting style of a `tag` element starting from `values`, projected with the DOM's
 * pure `project` and routed by tag (ADR-0014): an svg-inner element's keys become
 * attributes, everything else is style. `undefined` is an HTML element (a `useWardic`
 * spread, which doesn't know its tag).
 */
export const startingStyle = (tag: string | undefined, values: Values.Values): SplitPatch =>
  splitPatchForTag(tag, project(values))
