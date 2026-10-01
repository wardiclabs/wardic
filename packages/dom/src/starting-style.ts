/**
 * The Starting style (ADR-0003, ADR-0021): an element's style before its first Frame,
 * `project(resolveInitial(config))`, computed purely with no runtime. It is the server's
 * markup, the style the hydration render keeps, and the animation's `from`.
 *
 * Framework-free, so every binding renders it the same way on a server and on the client
 * (the thin-bindings rule): a binding reads its config, calls these, and casts the style to
 * its own JSX type. `toValues`, `resolveInitial` and `mergeStyle` moved here from
 * @wardic/solid with their behaviour unchanged. Tier 2, for binding authors.
 *
 * Observability: pure and per element, so quiet (no span, no log).
 */
import type { Patch, Values } from "@wardic/core"
import type { DragDefaultStyle } from "./drag-defaults.ts"
import { project } from "./renderer.ts"
import { type SplitPatch, splitPatchForTag } from "./svg.ts"

/**
 * A values map with only the keys an animation can take: numbers and strings (custom
 * properties included). `undefined` and anything else drop out, so the engine never sees
 * them.
 */
export const toValues = (v: Readonly<Record<string, unknown>> | undefined): Values => {
  const out: Record<string, number | string> = {}
  if (v) {
    for (const k in v) {
      const val = v[k]
      if (val !== undefined && (typeof val === "number" || typeof val === "string")) out[k] = val
    }
  }
  return out
}

/** The part of an element's config its Starting style is resolved from. */
export interface InitialConfig {
  /** A values map used as is, or the name of a `variants` entry. */
  readonly initial?: Readonly<Record<string, unknown>> | string | undefined
  readonly variants?: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> | undefined
}

/**
 * The values an element starts from: its `initial` map, or the `variants` entry its
 * `initial` names (an unknown name is empty), or nothing. Read once, at setup: the
 * Starting style is a seed, never a live target.
 */
export const resolveInitial = (config: InitialConfig): Values => {
  const initial = config.initial
  if (initial === undefined) return {}
  if (typeof initial === "string") return toValues(config.variants?.[initial])
  return toValues(initial)
}

/**
 * An element's style: the user's static style as the base, its animated keys on top, over
 * a drag element's defaults and a component's base style (ADR-0019 *Amendment
 * (Reorder)*): defaults < base < user < animated. With neither defaults nor base, the user's
 * style plus the animated keys, or the animated patch itself when the user has none.
 */
export const mergeStyle = (
  user: Readonly<Record<string, unknown>> | undefined,
  animated: Patch,
  defaults?: DragDefaultStyle,
  base?: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  if (defaults === undefined && base === undefined) return user !== undefined ? { ...user, ...animated } : animated
  const merged: Record<string, unknown> = { ...defaults, ...base, ...user, ...animated }
  // `user-select` and `-webkit-user-select` are one property in Chromium: the user's
  // value for either is the value for both, or the default left on the other wins.
  if (user !== undefined) {
    if (user["user-select"] !== undefined && user["-webkit-user-select"] === undefined) {
      merged["-webkit-user-select"] = user["user-select"]
    } else if (user["-webkit-user-select"] !== undefined && user["user-select"] === undefined) {
      merged["user-select"] = user["-webkit-user-select"]
    }
  }
  return merged
}

/**
 * The Starting style of a `tag` element starting from `values`, projected with the DOM's
 * pure `project` and routed by tag (ADR-0014): an svg-inner element's keys become
 * attributes, everything else is style. `undefined` is an HTML element (a `useWardic`
 * spread, which doesn't know its tag).
 */
export const startingStyle = (tag: string | undefined, values: Values): SplitPatch =>
  splitPatchForTag(tag, project(values))
