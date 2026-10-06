/**
 * SVG realization for the DOM renderer (ADR-0014). The core value pipeline +
 * the pure `project` stay AGNOSTIC and flat: SVG numeric attrs (`cx`/`r`/…)
 * already spring as numbers and `fill`/`stroke` already interpolate as colors.
 * This module is the DOM-API ROUTING layer — the one place that decides whether
 * a resolved value is written as a CSS `style` or an `setAttribute`, plus the
 * SVG-specific shaping (`transform-box`, `pathLength`→dash). It is the seam a
 * non-DOM SVG renderer (e.g. react-native-svg) would replace wholesale; nothing
 * here is shared with `@wardic/core`.
 *
 * Model (Motion's `buildSVGAttrs`): for an svg-INNER element every key is an
 * ATTRIBUTE except `transform`/`transformOrigin`/`transformBox` + the CSS
 * motion-path props, which stay STYLE. For an HTML element or the `<svg>` ROOT
 * everything is style (the root has a CSS box; only `viewBox` would be an attr —
 * deferred). So the HTML path is unchanged: its attribute map is always empty.
 */
import type { Patch } from "@wardic/core"

/**
 * Keys that remain CSS `style` on an svg-inner element; everything else routes
 * to an attribute. `transform` is applied as a CSS transform (with `transform-box`
 * below); the motion-path props are CSS-only on SVG too (Motion parity).
 */
const SVG_STYLE_KEYS: ReadonlySet<string> = new Set([
  "transform",
  "transformOrigin",
  "transform-origin",
  "transformBox",
  "transform-box",
  "offsetDistance",
  "offsetPath",
  "offsetRotate",
  "offsetAnchor",
])

/**
 * SVG attribute names always written camelCase (never dash-cased) — Motion's
 * `camelCaseAttributes`. Everything else is dash-cased (`strokeWidth` →
 * `stroke-width`).
 */
const CAMEL_CASE_ATTRS: ReadonlySet<string> = new Set([
  "baseFrequency",
  "diffuseConstant",
  "kernelMatrix",
  "kernelUnitLength",
  "keySplines",
  "keyTimes",
  "limitingConeAngle",
  "markerHeight",
  "markerWidth",
  "numOctaves",
  "targetX",
  "targetY",
  "surfaceScale",
  "specularConstant",
  "specularExponent",
  "stdDeviation",
  "tableValues",
  "viewBox",
  "gradientTransform",
  "pathLength",
  "startOffset",
  "textLength",
  "lengthAdjust",
])

/**
 * Escape hatches: `x`/`y` are transform shorthands in Wardic (translateX/Y), so
 * the SVG geometry ATTRIBUTE form is the explicit `attr*` key (Motion's
 * `attrX`/`attrY`/`attrScale`). Maps to the bare attribute name.
 */
const ATTR_ALIASES: Record<string, string> = { attrX: "x", attrY: "y", attrScale: "scale" }

/** camelCase → dash-case for a CSS/attribute name (`transformBox` → `transform-box`). */
export const dashCase = (key: string): string => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/** The attribute name for an engine key: dash-cased unless it's a known camelCase attr. */
const attrName = (key: string): string => (CAMEL_CASE_ATTRS.has(key) ? key : dashCase(key))

/**
 * The attribute an svg-inner element's `key` is written as (the routing below), or
 * `undefined` for a key that stays style ({@link SVG_STYLE_KEYS}) or collapses into the
 * stroke dash (`pathLength` / `pathSpacing` / `pathOffset`). Internal: the Own-value read
 * reads the attribute a key is written as (ADR-0022).
 */
export const svgAttrNameOf = (key: string): string | undefined => {
  if (key === "pathLength" || key === "pathSpacing" || key === "pathOffset") return undefined
  const alias = ATTR_ALIASES[key]
  if (alias !== undefined) return alias
  if (SVG_STYLE_KEYS.has(key)) return undefined
  return attrName(key)
}

/** A real `<svg>` ROOT (`SVGSVGElement`) — styled like HTML (it has a CSS box). */
export const isSvgRoot = (el: unknown): boolean =>
  typeof SVGSVGElement !== "undefined" && el instanceof SVGSVGElement

/** An svg-INNER element (any `SVGElement` that is not the `<svg>` root). */
export const isSvgInner = (el: unknown): boolean =>
  typeof SVGElement !== "undefined" && el instanceof SVGElement && !isSvgRoot(el)

/** The result of routing a flat `Patch`: CSS `style` keys vs DOM `attrs`. */
export interface SplitPatch {
  /** Keys to write as CSS style (always the whole patch for HTML / the svg root). */
  readonly style: Record<string, unknown>
  /** Keys to write via `setAttribute` (always empty for HTML / the svg root). */
  readonly attrs: Record<string, string>
}

/**
 * Route a flat (agnostic) `Patch` into CSS `style` + SVG `attrs` for `el`.
 *
 * - HTML / `<svg>` root: `{ style: patch, attrs: {} }` — unchanged behavior.
 * - svg-inner: every key → attribute, except {@link SVG_STYLE_KEYS} → style;
 *   `attrX`/`attrY`/`attrScale` → the `x`/`y`/`scale` attribute; a `transform`
 *   also yields `transform-box: fill-box` + `transform-origin: 50% 50%` (unless
 *   the value-map already set them — user wins), so an SVG transform reads like
 *   an HTML one; `pathLength`/`pathSpacing`/`pathOffset` collapse to a normalised
 *   `stroke-dasharray`/`stroke-dashoffset` (+ `pathLength=1`), unitless.
 */
export const splitPatch = (el: unknown, patch: Patch): SplitPatch =>
  isSvgInner(el) ? routeSvgInner(patch) : { style: patch as Record<string, unknown>, attrs: {} }

/**
 * SVG's element names that HTML doesn't share, lowercase (Motion's list,
 * framer-motion/src/render/svg/lowercase-elements.ts @ 16c6122, without the `svg` root).
 * A name with a capital letter (`clipPath`, `linearGradient`, `feGaussianBlur` …) is SVG
 * too, as Motion's `isSVGComponent` decides; `a`, `script`, `style` and `title` count as
 * HTML, since a server has no namespace to tell them apart.
 */
const SVG_INNER_TAGS: ReadonlySet<string> = new Set([
  "animate",
  "circle",
  "defs",
  "desc",
  "ellipse",
  "g",
  "image",
  "line",
  "filter",
  "marker",
  "mask",
  "metadata",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "rect",
  "stop",
  "switch",
  "symbol",
  "text",
  "tspan",
  "use",
  "view",
])

/** Whether `tag` names an svg-INNER element (any SVG element but the `<svg>` root), by name alone. */
export const isSvgInnerTag = (tag: string): boolean => !tag.includes("-") && (SVG_INNER_TAGS.has(tag) || /[A-Z]/.test(tag))

/**
 * {@link splitPatch} by tag name, for where there is no element yet: a server render and
 * the Starting style (ADR-0021). The same routing; `undefined` is an HTML element.
 */
export const splitPatchForTag = (tag: string | undefined, patch: Patch): SplitPatch =>
  tag !== undefined && isSvgInnerTag(tag) ? routeSvgInner(patch) : { style: patch as Record<string, unknown>, attrs: {} }

/** The svg-inner routing {@link splitPatch} and {@link splitPatchForTag} share. */
const routeSvgInner = (patch: Patch): SplitPatch => {
  const style: Record<string, unknown> = {}
  const attrs: Record<string, string> = {}
  let hasTransform = false
  let pathLength: unknown
  let pathSpacing: unknown
  let pathOffset: unknown

  for (const key in patch) {
    const value = patch[key]
    if (value === undefined) continue
    if (key === "pathLength") {
      pathLength = value
      continue
    }
    if (key === "pathSpacing") {
      pathSpacing = value
      continue
    }
    if (key === "pathOffset") {
      pathOffset = value
      continue
    }
    const alias = ATTR_ALIASES[key]
    if (alias !== undefined) {
      attrs[alias] = String(value)
      continue
    }
    if (SVG_STYLE_KEYS.has(key)) {
      style[key] = value
      if (key === "transform") hasTransform = true
      continue
    }
    attrs[attrName(key)] = String(value)
  }

  // SVG's transform-origin defaults to the document origin (0 0), not the element
  // centre — so a CSS transform on SVG reads differently from HTML. `fill-box` +
  // a centred origin restore HTML-like semantics (Motion). User-set wins.
  if (hasTransform) {
    if (style["transformBox"] === undefined && style["transform-box"] === undefined) {
      style["transform-box"] = "fill-box"
    }
    if (style["transformOrigin"] === undefined && style["transform-origin"] === undefined) {
      style["transform-origin"] = "50% 50%"
    }
  }

  // pathLength → normalised stroke dash (Motion's buildSVGPath). Unitless: Safari
  // mis-scales px dash values when the page is zoomed.
  if (pathLength !== undefined) {
    const spacing = pathSpacing ?? 1
    const offset = typeof pathOffset === "number" ? pathOffset : Number(pathOffset ?? 0)
    attrs["pathLength"] = "1"
    attrs["stroke-dasharray"] = `${pathLength} ${spacing}`
    attrs["stroke-dashoffset"] = String(Number.isFinite(offset) ? -offset : 0)
  }

  return { style, attrs }
}

/** Write each routed attribute onto `el` via `setAttribute`. No-op for an empty map. */
export const setSvgAttrs = (el: Element, attrs: Record<string, string>): void => {
  for (const name in attrs) el.setAttribute(name, attrs[name]!)
}
