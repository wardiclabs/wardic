/**
 * Base values in the DOM (ADR-0022): an element's Own value for a key, and the `style` link's
 * lookup. A binding calls these and hands them to core's `baseValueOf` / `startValueOf`, so a
 * new binding writes no DOM code for them (the thin-bindings rule). Tier 2, for binding
 * authors.
 *
 * Client-only: the read runs after mount, never during a server render (ADR-0021, "Nothing
 * reads the DOM on a server"). `styleValueOf` and `valueLike` are pure.
 *
 * Observability: per element and cold (once per key), so quiet; the spine logs what it
 * started from and returned to.
 */
import { transformIdentity, unitOf } from "@wardic/core"
import { parseCssText } from "./starting-style.ts"
import { dashCase, isSvgInner, svgAttrNameOf } from "./svg.ts"

/** An element's Own value for a key: the raw value read (a string), a transform key's identity, or `undefined`. */
export type OwnValue = (key: string) => number | string | undefined

/** The CSS name of a key: dash-cased, except a custom property, which keeps its name. */
const cssName = (key: string): string => (key.startsWith("--") ? key : dashCase(key))

/**
 * A reader of `element`'s Own values, each read once, at the key's first need, and kept
 * (a miss too): a later CSS change doesn't move it (Motion's C12). Per key:
 *
 * 1. a transform key: core's identity, with no read (Motion's projected branch,
 *    HTMLVisualElement.ts:51 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8);
 * 2. on an svg-inner element, a key written as an attribute (ADR-0014's routing): that
 *    attribute, if it has one;
 * 3. otherwise the computed style (a custom property by its own name).
 *
 * Creating a reader reads nothing. A read from an element not in the document isn't kept.
 * Read values are raw strings; coerce them with {@link valueLike}.
 */
export const ownValues = (element: Element): OwnValue => {
  const cache = new Map<string, number | string | undefined>()
  let computed: CSSStyleDeclaration | undefined
  const read = (key: string): number | string | undefined => {
    const identity = transformIdentity(key)
    if (identity !== undefined) return identity
    if (isSvgInner(element)) {
      const name = svgAttrNameOf(key)
      const attr = name !== undefined ? element.getAttribute(name) : null
      if (attr !== null && attr !== "") return attr
    }
    computed ??= getComputedStyle(element)
    const value = computed.getPropertyValue(cssName(key)).trim()
    return value === "" ? undefined : value
  }
  return (key) => {
    if (cache.has(key)) return cache.get(key)
    const value = read(key)
    // An element not in the document has an empty computed style: that miss isn't the
    // element's, so it isn't kept, and the key is read again once the element is in.
    if (element.isConnected) cache.set(key, value)
    return value
  }
}

/**
 * The user's `style` value for `key`, the `style` link of its Base value: an object style by
 * the key, then by the key dash-cased; a CSS-text style parsed as `mergeStyle` parses it.
 * `undefined`, `null` and an empty string are misses. A transform key has no `style` link:
 * in a DOM style, `scale`, `translate` and `rotate` are CSS properties of their own, which
 * compose with the element's transform rather than seed it.
 */
export const styleValueOf = (style: object | string | undefined, key: string): unknown => {
  if (style === undefined || style === null || transformIdentity(key) !== undefined) return undefined
  const map = (typeof style === "string" ? parseCssText(style) : style) as Readonly<Record<string, unknown>>
  const at = (k: string): unknown => {
    const v = Object.hasOwn(map, k) ? map[k] : undefined
    return v === null || v === "" ? undefined : v
  }
  const direct = at(key)
  if (direct !== undefined || key.startsWith("--")) return direct
  const dashed = dashCase(key)
  return dashed !== key ? at(dashed) : undefined
}

/** A plain number, or a number in `px`. */
const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(px)?\s*$/i

/**
 * `raw` in the shape of a key's target `like`, or `undefined` when it can't be:
 *
 * - a numeric target takes a finite number, or a plain-number or `px` string, parsed
 *   (`"0.5"` → 0.5, `"120px"` → 120); anything else misses (`auto`, `50%`, `1em`, a colour),
 *   so the key starts at its target and doesn't return. Motion converts units by measuring
 *   the element; Wardic doesn't.
 * - a string target takes a string as is, or a finite number as a string, except a length
 *   in another unit than the target's (`"120px"` for `"0%"`): the unit interpolator dies on
 *   that pair, so it misses, as a numeric target misses `50%`.
 */
export const valueLike = (raw: unknown, like: number | string): number | string | undefined => {
  if (typeof like === "number") {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined
    return typeof raw === "string" && NUMERIC.test(raw) ? Number.parseFloat(raw) : undefined
  }
  if (typeof raw === "string") {
    const want = unitOf(like)
    const got = unitOf(raw)
    const clash = want !== undefined && want !== "" && got !== undefined && got !== "" && got !== want
    return clash ? undefined : raw
  }
  return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined
}
