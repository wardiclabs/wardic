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
import * as Rec from "effect/Record"
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
  /** A values map used as is, or the name of a `variants` entry. */
  readonly initial?: object | string | undefined
  readonly variants?: Readonly<Record<string, object | undefined>> | undefined
}

/**
 * The values an element starts from: its `initial` map, or the `variants` entry its
 * `initial` names (an unknown name is empty), or nothing. Read once, at setup: the
 * Starting style is a seed, never a live target.
 */
export const resolveInitial = (config: InitialConfig): Values.Values => {
  const initial = config.initial
  if (initial === undefined) return {}
  if (typeof initial === "string") return toValues(config.variants?.[initial])
  return toValues(initial)
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
export const heldTouches = (
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
 * The Starting style of a `tag` element starting from `values`, projected with the DOM's
 * pure `project` and routed by tag (ADR-0014): an svg-inner element's keys become
 * attributes, everything else is style. `undefined` is an HTML element (a `useWardic`
 * spread, which doesn't know its tag).
 */
export const startingStyle = (tag: string | undefined, values: Values.Values): SplitPatch =>
  splitPatchForTag(tag, project(values))
