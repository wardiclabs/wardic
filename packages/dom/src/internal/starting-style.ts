/**
 * The Starting style (ADR-0003, ADR-0021): an element's style before its first Frame,
 * `project(resolveInitial(config))`, computed purely with no runtime. It is the server's
 * markup, the style the hydration render keeps, and the animation's `from`. And the style
 * after the first Frame, the fallback: the user's, without the keys Wardic holds (ADR-0034).
 *
 * Framework-free, so every binding renders it the same way on a server and on the client
 * (the thin-bindings rule): a binding reads its config, calls these, and casts the style to
 * its own JSX type. `toValues`, `resolveInitial` and the merge `over` does moved here from
 * @wardic/solid with their behaviour unchanged; `over` and `without` are `dual` (#132's PR 3,
 * ADR-0041 decision 5). Tier 2, for binding authors.
 *
 * Observability: pure and per element, so quiet (no span, no log).
 */
import type * as Values from "@wardic/core/Values"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { dual } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { project } from "./renderer.ts"
import { dashCase, type SplitPatch, splitPatchForTag } from "./svg.ts"

/**
 * A values map with only the keys an animation can take: numbers and strings (custom
 * properties included). `undefined` and anything else drop out, so the engine never sees
 * them.
 */
export const toValues = (v: object | undefined): Values.Values =>
  UndefinedOr.match(v, {
    onUndefined: (): Values.Values => ({}),
    onDefined: (values) => Rec.filter(values as Readonly<Record<string, unknown>>, isAnimatable),
  })

/** Whether a value is one an animation can take: a number or a string. */
const isAnimatable = Predicate.or(Predicate.isNumber, Predicate.isString)

/** A keyframes value's stops, as Motion's: each a value, or `null`, for where the key is (the first) or the stop before (a later one). */
// **Keyframes** (#429).
export type Stops = ReadonlyArray<number | string | null>

/** Where a keyframes value is read: `initial`'s at its first stop, a target's at its last. */
// **Keyframes** (#429).
export type StopAt = "first" | "last"

/** Whether a stop is one an animation can take, or `null`. */
const isStop = Predicate.or(isAnimatable, Predicate.isNull)

/**
 * A Keyframes value's stop (#429): its first, as Motion's `initial` reads it (`use-visual-state.ts`),
 * or its last that isn't `null`, where it rests (Motion's final keyframe, `fill-wildcards.ts`'s).
 * `null` or `undefined` when it has none.
 */
const stopOf = (stops: ReadonlyArray<unknown>, at: StopAt): unknown =>
  Bool.match(at === "first", { onTrue: () => stops[0], onFalse: () => Option.getOrUndefined(Arr.findLast(stops, Predicate.isNotNull)) })

/** Whether a value is Keyframes an animation can take (#429): an array of stops, one of them not `null`. */
const isStops = (value: unknown): value is Stops => {
  if (Bool.not(Arr.isArray(value))) return false
  const stops = value as ReadonlyArray<unknown>
  return Bool.and(Arr.every(stops, isStop), Arr.some(stops, Predicate.isNotNull))
}

/**
 * The Keyframes {@link keepAnimatable} set aside while it filtered a values map (#452): written by it,
 * read and cleared right after, never across a call. A target with none leaves it `undefined`.
 */
// Module state (#460, Q7): scratch within one synchronous call, never held across one.
let setAside: Record<string, Stops> | undefined

/**
 * A values map's filter (#452): a value an animation can take stays, and Keyframes go aside, into
 * {@link setAside}, so one pass over the keys finds both. Built once, at module load.
 */
const keepAnimatable = (value: unknown, key: string): boolean => {
  if (Bool.not(Arr.isArray(value))) return isAnimatable(value)
  if (isStops(value)) {
    if (Predicate.isUndefined(setAside)) setAside = {}
    setAside[key] = value
  }
  return false
}

/** A values map's numbers and strings, its Keyframes set aside (#452, {@link keepAnimatable}): {@link toValues}' one pass. */
const filtered = (v: object | undefined): Values.Values => {
  // Per element at mount (#540): statements and a loop.
  setAside = undefined
  const out: Record<string, number | string> = {}
  if (Predicate.isUndefined(v)) return out
  const values = v as Readonly<Record<string, unknown>>
  for (const key of Object.keys(values)) {
    const value = values[key]
    // `keepAnimatable` keeps numbers and strings alone, as `isAnimatable` does.
    if (keepAnimatable(value, key)) out[key] = value as number | string
  }
  return out
}

/** The Keyframes the last {@link filtered} set aside, taken: `undefined` with none. */
const takeSetAside = (): Readonly<Record<string, Stops>> | undefined => {
  const taken = setAside
  setAside = undefined
  return taken
}

/** `values` with each of `keyframes` at one of its stops (#429), one with no such stop left out. */
const withStops = (values: Values.Values, keyframes: Readonly<Record<string, Stops>>, at: StopAt): Values.Values => ({
  ...values,
  ...toValues(Rec.map(keyframes, (stops) => stopOf(stops, at))),
})

/** A values map's own values and its keyframes: `splitValues`' result. */
// #452.
export interface SplitValues {
  /** Its numbers and strings, each Keyframes value at one of its stops. */
  readonly values: Values.Values
  /** Its Keyframes, if it has any. */
  // An `Option` (#618, A1): none is Effect's one `None`, so a target with no Keyframes allocates nothing.
  readonly keyframes: Option.Option<Readonly<Record<string, Stops>>>
}

/**
 * A values map's values, each keyframes value read at one of its stops, and its keyframes, in one pass
 * over its keys: a target's resolution reads both, and a target with no keyframes makes nothing
 * `toValues` doesn't.
 */
// **Keyframes** (#429); one pass (#452).
export const splitValues = (v: object | undefined, at: StopAt): SplitValues => {
  const values = filtered(v)
  const keyframes = takeSetAside()
  if (Predicate.isUndefined(keyframes)) return { values, keyframes: Option.none() }
  return { values: withStops(values, keyframes, at), keyframes: Option.some(keyframes) }
}

/**
 * A values map with only the keys an animation can take, each keyframes value read at one of its stops:
 * `initial`'s first, a target's last. A keyframes value with no such stop drops out, as does an array
 * `keyframesOf` doesn't take, and anything that isn't a number or a string. One pass over its keys, as
 * `toValues`'.
 *
 * @example
 * Style.valuesAt({ opacity: [0, 0.5, 1], x: 10 }, "first") // { x: 10, opacity: 0 }
 */
// **Keyframes** (#429); one pass (#452).
export const valuesAt = (v: object | undefined, at: StopAt): Values.Values => {
  const values = filtered(v)
  const keyframes = takeSetAside()
  if (Predicate.isUndefined(keyframes)) return values
  return withStops(values, keyframes, at)
}

/**
 * A values map's keyframes values: each array of stops an animation can take, one with a stop that isn't
 * `null`. None when it has none, so a target without any makes nothing.
 *
 * @example
 * Style.keyframesOf({ opacity: [0, 0.5, 1], x: 10 }) // { opacity: [0, 0.5, 1] }
 */
// **Keyframes** (#429).
export const keyframesOf = (v: object | undefined): Option.Option<Readonly<Record<string, Stops>>> => splitValues(v, "last").keyframes

/**
 * What of an element's config its starting style is read from. Its values are typed `object`, so a
 * binding's own value types fit as they are.
 */
export interface InitialConfig {
  /**
   * Its start: values used as they are, the name of a `variants` entry, a list of names merged in order,
   * a later one's winning, or `false`, to start at `animate`, as Motion's `initial={false}`.
   */
  // #297 (lists); #134 (`false`).
  readonly initial?: object | string | ReadonlyArray<string> | false | undefined
  /** What `initial: false` starts at: a values map, the name of a `variants` entry, or a list of names. */
  readonly animate?: object | string | ReadonlyArray<string> | undefined
  /** Its variants: the values each name stands for. */
  readonly variants?: Readonly<Record<string, object | undefined>> | undefined
}

/** One values entry, the variants a name in it would name, and the stop its Keyframes values are read at (#429). */
interface Entry {
  readonly entry: object | string | ReadonlyArray<string> | undefined
  readonly variants: InitialConfig["variants"]
  readonly at: StopAt
}

/** Whether an entry is a list of names (#297): an array, which a values map never is. */
const isList = (entry: unknown): entry is ReadonlyArray<string> => Arr.isArray(entry)

/**
 * A values map, or the `variants` entry a name names (an unknown name is empty), or nothing.
 * Built once, at module load: every element reads its own at setup (#69).
 */
const entryOf: (entry: Entry) => Values.Values = Match.type<Entry>().pipe(
  Match.when({ entry: Match.undefined }, (): Values.Values => ({})),
  Match.when({ entry: Match.string }, ({ entry, variants, at }) => valuesAt(UndefinedOr.map(variants, (byName) => byName[entry]), at)),
  // A list's names merged in order, a later one's winning a key both set (#297, Motion's).
  Match.when({ entry: isList }, ({ entry, variants, at }) =>
    Arr.reduce(entry, {} as Values.Values, (merged, name) => ({ ...merged, ...valuesAt(UndefinedOr.map(variants, (byName) => byName[name]), at) }))),
  Match.orElse(({ entry, at }) => valuesAt(entry as object, at)),
)

/**
 * The values an element starts from: its `initial` values, or the `variants` entries its `initial` names,
 * an unknown name empty, or nothing. With `initial: false`, its `animate`, resolved the same way, so it
 * starts at its target and nothing animates at mount, as Motion's. A keyframes value starts at its first
 * stop, or, with `initial: false`, at `animate`'s last, where the animation it skips would end. Read once,
 * at setup: the starting style is where it starts, never a live target.
 *
 * @example
 * Style.resolveInitial({ initial: false, animate: { opacity: 1 } }) // { opacity: 1 }
 */
// #134, Motion's `initial={false}`; **Keyframes** (#429, Motion's `use-visual-state.ts`).
export const resolveInitial = (config: InitialConfig): Values.Values => {
  // Per element at mount (#540): statements.
  if (config.initial === false) return entryOf({ entry: config.animate, variants: config.variants, at: "last" })
  return entryOf({ entry: config.initial as object | string | ReadonlyArray<string> | undefined, variants: config.variants, at: "first" })
}

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
