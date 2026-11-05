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
 * motion-path props, which stay STYLE, and a custom property (`--…`), which is style
 * under its own name on every element (#151). For an HTML element or the `<svg>` ROOT
 * everything is style (the root has a CSS box; only `viewBox` would be an attr —
 * deferred). So the HTML path is unchanged: its attribute map is always empty.
 */
import type * as Renderer from "@wardic/core/Renderer"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"

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

/**
 * Each key's dash-cased name, computed once (ADR-0034): the commit dash-cases every key of
 * every patch, each frame. Keys come from animation configs, so the set stays small.
 */
// Module state (#460, Q7): a cache keyed by what it caches: a bounded set of names.
const DASHED = new Map<string, string>()

/**
 * Whether `key` is a CSS custom property (`--brandColor`): it keeps its name, which is
 * case-sensitive, and is always a style property, on SVG too (ADR-0014, *Amendment (#151)*;
 * Motion's `isCSSVariableName`).
 */
const isCustomProperty = (key: string): boolean => key.startsWith("--")

/**
 * camelCase → dash-case for a CSS/attribute name (`transformBox` → `transform-box`); a
 * custom property keeps its name (`--brandColor`).
 */
export const dashCase = (key: string): string => {
  const cached = DASHED.get(key)
  if (Predicate.isNotUndefined(cached)) return cached
  const dashed = Bool.match(isCustomProperty(key), {
    onTrue: () => key,
    onFalse: () => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
  })
  DASHED.set(key, dashed)
  return dashed
}

/** The attribute name for an engine key: dash-cased unless it's a known camelCase attr. */
const attrName = (key: string): string => {
  if (CAMEL_CASE_ATTRS.has(key)) return key
  return dashCase(key)
}

/** Whether a key collapses into the stroke dash: `pathLength`, `pathSpacing` or `pathOffset`. */
export const isPathKey = (key: string): boolean => key === "pathLength" || key === "pathSpacing" || key === "pathOffset"

/**
 * The attribute an svg-inner element's `key` is written as (the routing below), or
 * `None` for a key that stays style ({@link SVG_STYLE_KEYS}, a custom property) or collapses into the
 * stroke dash (`pathLength` / `pathSpacing` / `pathOffset`). Internal: the Own-value read
 * reads the attribute a key is written as (ADR-0022).
 */
export const svgAttrNameOf = (key: string): Option.Option<string> =>
  Bool.match(isPathKey(key) || isCustomProperty(key), {
    onTrue: () => Option.none(),
    onFalse: () =>
      Option.orElse(Option.fromUndefinedOr(ATTR_ALIASES[key]), () =>
        Option.map(Option.liftPredicate(key, (k: string) => Bool.not(SVG_STYLE_KEYS.has(k))), attrName)
      ),
  })

/** Whether `el` is an `<svg>` root, which is styled as HTML is: it has a CSS box. */
export const isSvgRoot = (el: unknown): boolean => {
  // No SVG classes on a server. Per frame (a flush's split): plain checks.
  const SvgRoot = (globalThis as { readonly SVGSVGElement?: typeof SVGSVGElement }).SVGSVGElement
  return Predicate.isNotUndefined(SvgRoot) && el instanceof SvgRoot
}

/** Whether `el` is an SVG element inside an `<svg>`: any SVG element but the root. */
export const isSvgInner = (el: unknown): boolean => {
  const Svg = (globalThis as { readonly SVGElement?: typeof SVGElement }).SVGElement
  return Predicate.isNotUndefined(Svg) && el instanceof Svg && !isSvgRoot(el)
}

/** A style patch, split: the keys written as CSS, and the ones written as attributes. */
export interface SplitPatch {
  /** The keys written as CSS: the whole patch for HTML and an `<svg>` root. */
  readonly style: Record<string, unknown>
  /** The keys written with `setAttribute`: none for HTML and an `<svg>` root. */
  readonly attrs: Record<string, string>
}

/**
 * A style patch split for `el`: an HTML element's, or an `<svg>` root's, is all style. An SVG element
 * inside one takes every key as an attribute but the keys CSS styles and a custom property; `attrX`,
 * `attrY` and `attrScale` as its `x`, `y` and `scale` attributes; a `transform` with `transform-box:
 * fill-box` and `transform-origin: 50% 50%`, unless the values set them, so it turns about its own centre
 * as an HTML element does; and `pathLength`, `pathSpacing` and `pathOffset` as a normalised
 * `stroke-dasharray` and `stroke-dashoffset`, with `pathLength="1"`.
 */
// The CSS keys: `SVG_STYLE_KEYS`.
export const splitPatch = (el: unknown, patch: Renderer.Patch): SplitPatch => {
  if (isSvgInner(el)) return routeSvgInner(patch)
  return { style: patch as Record<string, unknown>, attrs: {} }
}

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

/** Whether `tag` names an SVG element inside an `<svg>`, by its name alone. */
export const isSvgInnerTag = (tag: string): boolean => !tag.includes("-") && (SVG_INNER_TAGS.has(tag) || /[A-Z]/.test(tag))

/** `splitPatch` by tag name, for where there's no element yet: a server render, a starting style. `undefined` is an HTML element. */
// ADR-0021.
export const splitPatchForTag = (tag: string | undefined, patch: Renderer.Patch): SplitPatch =>
  Bool.match(Predicate.isNotUndefined(tag) && isSvgInnerTag(tag), {
    onTrue: () => routeSvgInner(patch),
    onFalse: () => ({ style: patch as Record<string, unknown>, attrs: {} }),
  })

/** The svg-inner routing {@link splitPatch} and {@link splitPatchForTag} share. */
const routeSvgInner = (patch: Renderer.Patch): SplitPatch => {
  const style: Record<string, unknown> = {}
  const attrs: Record<string, string> = {}
  let hasTransform = false
  let pathLength: unknown
  let pathSpacing: unknown
  let pathOffset: unknown

  for (const key in patch) {
    const value = patch[key]
    if (Predicate.isUndefined(value)) continue
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
    const alias: string | undefined = ATTR_ALIASES[key]
    if (Predicate.isNotUndefined(alias)) {
      attrs[alias] = String(value)
      continue
    }
    if (SVG_STYLE_KEYS.has(key)) {
      style[key] = value
      if (key === "transform") hasTransform = true
      continue
    }
    // A custom property is a style property (ADR-0014, *Amendment (#151)*).
    if (isCustomProperty(key)) {
      style[key] = value
      continue
    }
    attrs[attrName(key)] = String(value)
  }

  // SVG's transform-origin defaults to the document origin (0 0), not the element
  // centre — so a CSS transform on SVG reads differently from HTML. `fill-box` +
  // a centred origin restore HTML-like semantics (Motion). User-set wins.
  if (hasTransform) {
    if (Predicate.isUndefined(style["transformBox"]) && Predicate.isUndefined(style["transform-box"])) {
      style["transform-box"] = "fill-box"
    }
    if (Predicate.isUndefined(style["transformOrigin"]) && Predicate.isUndefined(style["transform-origin"])) {
      style["transform-origin"] = "50% 50%"
    }
  }

  // pathLength → normalised stroke dash (Motion's buildSVGPath). Unitless: Safari
  // mis-scales px dash values when the page is zoomed.
  if (Predicate.isNotUndefined(pathLength)) {
    attrs["pathLength"] = "1"
    attrs["stroke-dasharray"] = `${pathLength} ${spacingOf(pathSpacing)}`
    attrs["stroke-dashoffset"] = String(dashOffsetOf(offsetOf(pathOffset)))
  }

  return { style, attrs }
}

// The stroke dash's parts, per frame: early returns.
/** `pathSpacing`, 1 when none is given. */
const spacingOf = (spacing: unknown): unknown => {
  if (Predicate.isNullish(spacing)) return 1
  return spacing
}
/** `pathOffset` as a number, 0 when none is given. */
const offsetOf = (offset: unknown): number => {
  if (Predicate.isNumber(offset)) return offset
  if (Predicate.isNullish(offset)) return 0
  return Number(offset)
}
/** The dash offset an offset draws: its negation, 0 for one that isn't finite. */
const dashOffsetOf = (offset: number): number => {
  if (Number.isFinite(offset)) return -offset
  return 0
}

/** Writes each attribute onto `el` with `setAttribute`; nothing for an empty map. */
export const setSvgAttrs = (el: Element, attrs: Record<string, string>): void => {
  for (const name in attrs) el.setAttribute(name, attrs[name])
}
