/**
 * `RendererDomLive` — the browser realization of `Renderer` (ADR-0002).
 *
 * Split into the two halves the contract mandates:
 *
 *   - {@link project} — PURE, synchronous: translates engine values into a DOM
 *     `Patch`. Its one piece of real work is grouping the individual transform
 *     keys (`x`/`y`/`scale`/`rotate`/…) into a single CSS `transform` string in
 *     a canonical order, and applying default units (px/deg) to bare numbers.
 *     Reused by the Starting style so this grouping/unit logic isn't duplicated in
 *     the binding (ADR-0002). No side effects, no Effect.
 *   - {@link commit} — imperative: writes each `Patch` entry onto `target.style`, now.
 *     The flush gate calls it once per element per Refresh frame (ADR-0034), and
 *     `applyTo` once per Frame.
 *
 * Observability (CONTEXT.md convention): `project` and `commit` are the
 * per-frame hot path, so — exactly like core's `applyTo` per-frame writes and
 * the Clock's `tick` — they stay quiet (no span, no per-call log).
 */
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Point from "@wardic/core/Point"
import * as Projection from "@wardic/core/Projection"
import * as Renderer from "@wardic/core/Renderer"
import { dashCase, isSvgInner, setSvgAttrs, splitPatch } from "./svg.ts"
import * as Bool from "effect/Boolean"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * CSS transform functions in their canonical emission order: translate group,
 * then scale, then rotate, then skew. `project` walks this list and emits a
 * func for each key that is present in `values` and not at its identity, so the
 * resulting `transform` string is always grouped in this order regardless of
 * input key order.
 *
 * `key` is the property name accepted on engine values (shorthands `x`/`y`/`z`
 * included); `fn` is the CSS function name it renders as; `identity` is core's
 * (ADR-0022), the value at which `project` leaves the key out (ADR-0023).
 */
// Exported for the Batch writer (#665), which draws a member's transform in the same order.
export const TRANSFORM_FUNCS: ReadonlyArray<{ readonly key: string; readonly fn: string; readonly identity: number }> = [
  // translate group — shorthands x/y/z map onto translateX/Y/Z
  { key: "x", fn: "translateX" },
  { key: "y", fn: "translateY" },
  { key: "z", fn: "translateZ" },
  { key: "translateX", fn: "translateX" },
  { key: "translateY", fn: "translateY" },
  { key: "translateZ", fn: "translateZ" },
  // scale group — `scale` is uniform scale(v); scaleX/scaleY are per-axis (flip)
  { key: "scale", fn: "scale" },
  { key: "scaleX", fn: "scaleX" },
  { key: "scaleY", fn: "scaleY" },
  // rotate group: a path's turn after the element's own (#438), which `rotate(a) rotate(b)` adds up
  { key: "rotate", fn: "rotate" },
  { key: "pathRotation", fn: "rotate" },
  { key: "rotateX", fn: "rotateX" },
  { key: "rotateY", fn: "rotateY" },
  { key: "rotateZ", fn: "rotateZ" },
  // skew group
  { key: "skewX", fn: "skewX" },
  { key: "skewY", fn: "skewY" },
].map((f) => ({ ...f, identity: UndefinedOr.getOrThrow(BaseValue.TRANSFORM_IDENTITY[f.key]) }))

/**
 * Whether a transform value is at its identity (ADR-0023), Motion's test
 * (motion-dom build-transform.ts:42-48 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8):
 * a number equal to it, or a string `parseFloat` takes to it (`"0px"`, `"0%"`,
 * `"0deg"`; never `"calc(0px)"` or `"var(--x)"`). Exact: a settled spring lands on
 * its target, and a value next to the identity mid-flight is still written.
 */
const isIdentity = (value: unknown, identity: number): boolean => {
  if (Predicate.isNumber(value)) return value === identity
  return Predicate.isString(value) && Number.parseFloat(value) === identity
}

/** `value` when it's a number, else `fallback`. Per frame: an early return, no Option. */
const numberOr = (value: unknown, fallback: number): number => {
  if (Predicate.isNumber(value)) return value
  return fallback
}

/** Default unit appended to a bare numeric transform value, by transform key. */
export type TransformUnit = "px" | "deg" | ""

/**
 * Default-unit map for transform values: translate (and the x/y/z shorthands)
 * are lengths → `px`; rotate/skew are angles → `deg`; scale* are unitless.
 * A value that is already a string is used verbatim (explicit units honoured),
 * so this map only drives the formatting of bare numbers.
 */
const TRANSFORM_UNITS: Record<string, TransformUnit> = {
  x: "px",
  y: "px",
  z: "px",
  translateX: "px",
  translateY: "px",
  translateZ: "px",
  scale: "",
  scaleX: "",
  scaleY: "",
  rotate: "deg",
  pathRotation: "deg",
  rotateX: "deg",
  rotateY: "deg",
  rotateZ: "deg",
  skewX: "deg",
  skewY: "deg",
}

/**
 * Fast membership test for "is this key a transform key?": core's transform keys, the ones
 * it gives an identity (ADR-0022), so the two lists can't drift. Every one has a unit above.
 */
const TRANSFORM_KEYS: ReadonlySet<string> = new Set(Object.keys(BaseValue.TRANSFORM_IDENTITY))

/**
 * The CSS properties a bare number on is a length, drawn in `px`, spelled as Wardic's keys are
 * (`margin-top`): Motion's, and `min-width`, `min-height`, the gaps and `letter-spacing`. The Solid
 * bindings' value types take a number on these and on no other length, so a number never draws CSS a
 * browser drops. `line-height` isn't one: CSS reads its bare number as a multiple. A number on any other
 * key, `opacity`, `z-index`, a custom property, is drawn as it is; a string always is.
 */
// #522: Motion's `numberValueTypes`' `px` keys; the bindings' `WardicValues`.
export const LENGTH_KEYS = [
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "letter-spacing",
  "background-position-x",
  "background-position-y",
] as const

/** One of `LENGTH_KEYS`: a CSS property a bare number on is drawn in `px`. */
export type LengthKey = (typeof LENGTH_KEYS)[number]

/** {@link LENGTH_KEYS}, for a membership test a frame can make. */
const LENGTH_KEY_SET: ReadonlySet<string> = new Set(LENGTH_KEYS)

/**
 * Format one transform value into its CSS func argument. Strings pass through
 * verbatim (explicit units respected); numbers get the key's default unit.
 */
const formatTransformValue = (key: string, value: unknown): string => {
  if (Predicate.isString(value)) return value
  if (Predicate.isNumber(value)) return `${value}${unitOf(key)}`
  return String(value)
}

/** A transform key's default unit; none for a key the table doesn't name. */
// Exported for the Batch writer (#665).
export const unitOf = (key: string): TransformUnit => {
  const unit: TransformUnit | undefined = TRANSFORM_UNITS[key]
  if (Predicate.isUndefined(unit)) return ""
  return unit
}

/**
 * The unit {@link project} draws a bare number of `key` in: a transform key's (`px`, `deg`, or none
 * for a scale), `px` for a length key, none for the rest. The Appear sampler judges its stops in it
 * (#48, ADR-0044).
 */
export const drawnUnitOf = (key: string): TransformUnit =>
  Bool.match(LENGTH_KEY_SET.has(key), { onTrue: (): TransformUnit => "px", onFalse: () => unitOf(key) })

/**
 * Format one non-transform value. Strings pass through verbatim; numbers on a
 * known length key get `px`; every other number stays raw (unitless).
 */
const formatStyleValue = (key: string, value: unknown): unknown => {
  if (Predicate.isNumber(value) && LENGTH_KEY_SET.has(key)) return `${value}px`
  return value
}

/**
 * User-animated transform funcs woven INTO a projection transform (ADR-0009,
 * Motion's `buildProjectionTransform`): `rotate`/`skew` compose with a layout
 * projection and are emitted between the inverse-tree-scale and the element
 * scale, each left out at its identity, 0 (ADR-0009 *Amendment (#57)*). The element's own
 * translate is added to the projection's ({@link ownTranslate}, #363), its own
 * `scale`/`scaleX`/`scaleY` multiply the element scale ({@link ownScale}), and `z` is folded
 * into the projection's `translate3d` (handled inline).
 */
const PROJECTION_WOVEN: ReadonlyArray<{ readonly key: string; readonly fn: string }> = [
  { key: "rotate", fn: "rotate" },
  { key: "pathRotation", fn: "rotate" },
  { key: "rotateX", fn: "rotateX" },
  { key: "rotateY", fn: "rotateY" },
  { key: "rotateZ", fn: "rotateZ" },
  { key: "skewX", fn: "skewX" },
  { key: "skewY", fn: "skewY" },
]

/**
 * The element's own scale on one axis (ADR-0009 *Amendment (Reorder)*): `scale` times
 * `scaleX` (or `scaleY`), 1 for an absent or non-numeric value. Motion renders a
 * projected node with the delta to its target with the element's own transforms
 * applied (`transformBox(targetWithTransforms, latestValues)`,
 * create-projection-node.ts:1820-1845 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8);
 * scaled about the box centre, that multiplies the element scale by this factor and
 * leaves the translate alone (delta-apply.ts:18-30). So a `whileDrag: { scale }` on a
 * `layout` element shows, and its children scale with it through CSS, as in Motion.
 */
const ownScale = (latest: Record<string, unknown>, axisKey: "scaleX" | "scaleY"): number =>
  numberOr(latest.scale, 1) * numberOr(latest[axisKey], 1)

/**
 * A translate key's pixels on a projected element (#363): a number, or a px string. Another unit
 * (`%`, `rem`) can't be added to the projection's pixel translate without measuring, so it's 0 here,
 * and {@link otherUnitTranslate} draws it as CSS (#594). Per frame.
 */
const pxOf = (value: unknown): number => {
  if (Predicate.isNumber(value)) return value
  if (!Predicate.isString(value)) return 0
  if (!value.endsWith("px")) return 0
  const px = Number.parseFloat(value)
  if (Number.isFinite(px)) return px
  return 0
}

/**
 * The element's own translate on one axis (#363, ADR-0009 *Amendment (#363)*): `x` plus
 * `translateX` (or `y` plus `translateY`), in page pixels. Motion lays a layout element's own `x`
 * and `y` on its target box (`transformBox(targetWithTransforms, latestValues)`,
 * `applyTransformsToTarget` at 16c6122), so its delta carries them, divided by the tree scale where
 * it's drawn: this is added to the projection's translate the same way. Motion leaves
 * `translateX`/`translateY` out; nothing set on a layout element is dropped here.
 */
const ownTranslate = (latest: Record<string, unknown>, key: "x" | "y", translateKey: "translateX" | "translateY"): number => pxOf(latest[key]) + pxOf(latest[translateKey])

/** A length in another unit than px: `-100%`, `1.5rem`, `50vw`. */
const OTHER_UNIT = /^-?[\d.]+(?!px$)[a-z%]+$/i

/** A translate key's CSS when it's a length in another unit than px (#594), else `0px`: {@link pxOf} reads the rest. */
const otherUnitOf = (value: unknown): string => {
  if (Predicate.isString(value) && OTHER_UNIT.test(value)) return value
  return "0px"
}

/**
 * One axis pair's CSS translate when either is in another unit than px (#594), else "". The browser
 * resolves it against the element's own box, as it would on a plain element.
 */
const otherUnitTranslate = (x: unknown, y: unknown): string => {
  const cssX = otherUnitOf(x)
  const cssY = otherUnitOf(y)
  if (cssX === "0px" && cssY === "0px") return ""
  return `translate(${cssX}, ${cssY})`
}

/**
 * An element's own move, from its values: what the renderer draws on top of its projection. A binding
 * hands it to the element's layout node, so a twin, a handover and a follower start from, and are drawn,
 * where it's drawn.
 */
// `ownTranslate`; #363. Tier 2, for binding authors.
export const ownTranslateOf = (values: Readonly<Record<string, unknown>>): Point.Point => ({
  x: ownTranslate(values, "x", "translateX"),
  y: ownTranslate(values, "y", "translateY"),
})

/**
 * An element's own scale on each axis, from its values: what the renderer draws on top of its projection.
 * A binding hands it to the element's layout node, so a handover starts from where a twin is drawn, and a
 * follower is drawn where its lead is.
 */
// `ownScale`; ADR-0010 *Amendment (#8)*. Tier 2, for binding authors.
export const ownScaleOf = (values: Readonly<Record<string, unknown>>): Point.Point => ({
  x: ownScale(values, "scaleX"),
  y: ownScale(values, "scaleY"),
})

/**
 * An element's own `rotate`, in degrees, from its values: what the renderer weaves into its projection,
 * 0 when it's absent or not a number. A binding hands it to the element's layout node, so a handover
 * blends from a twin's rotation into its own.
 */
// `ownRotate`; ADR-0010 *Amendment (#166)*. Tier 2, for binding authors.
export const ownRotateOf = (values: Readonly<Record<string, unknown>>): number => numberOr(values.rotate, 0)

/**
 * An element's own opacity, from its values: what the renderer draws, 1 when it's absent or not a
 * number. A binding hands it to the element's layout node, so a handover blends from the leaving
 * element's opacity into it.
 */
// `ownOpacity`; a Switch (ADR-0010 *Amendment (#166)*). Tier 2, for binding authors.
export const ownOpacityOf = (values: Readonly<Record<string, unknown>>): number => numberOr(values.opacity, 1)

/**
 * Assemble a projection transform string (ADR-0009), ported from Motion's
 * `buildProjectionTransform`: `translate3d` (translation divided by `treeScale`)
 * → inverse tree-scale `scale(1/treeScale)` → woven user `rotate`/`skew` (from
 * `latest`, the element's value-map) → element `scale(delta.scale × treeScale)`.
 * Each term is emitted only when it is non-identity; with nothing to emit the
 * result is `"none"` (an identity projection carrying no woven transform).
 */
const buildProjectionTransform = (
  delta: Projection.Delta,
  treeScale: Point.Point,
  latest: Readonly<Record<string, unknown>>,
  rotate: number | undefined,
): string => {
  const funcs: Array<string> = []

  // The element's own translate, in page pixels, on the projection's: divided by the tree scale
  // together, as Motion's target box carries it (#363).
  const tx = (delta.x.translate + ownTranslate(latest, "x", "translateX")) / treeScale.x
  const ty = (delta.y.translate + ownTranslate(latest, "y", "translateY")) / treeScale.y
  const z = latest["z"]
  const translateZ = latest["translateZ"]
  if (tx !== 0 || ty !== 0 || (Predicate.isNotUndefined(z) && !isIdentity(z, 0)) || (Predicate.isNotUndefined(translateZ) && !isIdentity(translateZ, 0))) {
    funcs.push(`translate3d(${tx}px, ${ty}px, ${zArgOf(z, translateZ)})`)
  }

  if (treeScale.x !== 1 || treeScale.y !== 1) {
    funcs.push(`scale(${1 / treeScale.x}, ${1 / treeScale.y})`)
  }

  for (const { key, fn } of PROJECTION_WOVEN) {
    // A handover's blended rotation stands in for the element's own (ADR-0010, *Amendment (#166)*).
    if (key === "rotate" && Predicate.isNotUndefined(rotate)) {
      if (rotate !== 0) funcs.push(`rotate(${formatTransformValue(key, rotate)})`)
      continue
    }
    if (Object.hasOwn(latest, key) && !isIdentity(latest[key], 0)) funcs.push(`${fn}(${formatTransformValue(key, latest[key])})`)
  }

  const sx = delta.x.scale * treeScale.x * ownScale(latest, "scaleX")
  const sy = delta.y.scale * treeScale.y * ownScale(latest, "scaleY")
  if (sx !== 1 || sy !== 1) funcs.push(`scale(${sx}, ${sy})`)

  // An own translate in another unit than px (`x: "-100%"`) can't be added to the projection's pixels,
  // so it's drawn before them, and the browser resolves it against the element's own box (#594). The
  // projection's own math (a handover's start) counts it as 0.
  const ownByUnit = otherUnitTranslate(latest["x"], latest["y"])
  const translateByUnit = otherUnitTranslate(latest["translateX"], latest["translateY"])
  if (translateByUnit !== "") funcs.unshift(translateByUnit)
  if (ownByUnit !== "") funcs.unshift(ownByUnit)
  if (funcs.length === 0) return "none"
  return funcs.join(" ")
}

/**
 * The key an element's transform template rides under in its values, as its projection rides under
 * `Projection.KEY`: `project` calls it for the element's transform. Namespaced, `@transformTemplate`, so
 * it never collides with a CSS property or a value's key.
 */
// A **Transform template** (#443, Motion's `transformTemplate`). Tier 2, for binding authors.
export const TEMPLATE_KEY = "@transformTemplate"

/**
 * A transform template, as Motion's `transformTemplate`: the element's whole transform, from its values
 * and the transform Wardic would draw (`generated`). `project` calls it:
 * - **at a plain render**, with its transform keys in their units (`x: "10px"`, `rotate: "45deg"`,
 *   `scale: 1.5`), and `generated` `""` when every one is at its identity, or it has none;
 * - **while a projection moves it**, with its values as they are (`x: 10`) and the projection's
 *   transform; once nothing moves it, as at a plain render;
 * - **held for a measure**, with its values and `""` (`heldTransformOf`).
 *
 * @example
 * const centred: DomRenderer.TransformTemplate = (_values, generated) => `translateX(-50%) ${generated}`
 */
// A **Transform template** (#443).
export type TransformTemplate = (values: Readonly<Record<string, string | number>>, generated: string) => string

/** `values`' template, or `undefined`: a function under {@link TEMPLATE_KEY}. Per frame: an early return. */
const templateOf = (values: Record<string, unknown>): TransformTemplate | undefined => {
  const template = values[TEMPLATE_KEY]
  if (Predicate.isFunction(template)) return template as TransformTemplate
  return undefined
}

/**
 * An element's transform keys as a template takes them at a plain render (#443, Motion's
 * `buildTransform`): each one it has, at its identity too, a number in its unit (`x: "10px"`,
 * `rotate: "45deg"`) and a scale's as it is (`1.5`). Not `pathRotation`, which Motion adds to the
 * transform alone (#438). A templated element's, per frame.
 */
const templateValuesOf = (values: Record<string, unknown>): Record<string, string | number> => {
  const out: Record<string, string | number> = {}
  for (const { key } of TRANSFORM_FUNCS) {
    if (key === "pathRotation" || !Object.hasOwn(values, key)) continue
    const value = values[key]
    out[key] = templateValueOf(key, value)
  }
  return out
}

/** One transform value as a template takes it: a number in its key's unit, a unitless one as it is, a string as it is. */
const templateValueOf = (key: string, value: unknown): string | number => {
  if (Predicate.isString(value)) return value
  if (!Predicate.isNumber(value)) return String(value)
  const unit = unitOf(key)
  if (unit === "") return value
  return `${value}${unit}`
}

/**
 * An element's values as a template takes them while projected or held (#443, Motion's
 * `latestValues`): every one as it is, but the reserved keys. A templated element's, per frame.
 */
const rawValuesOf = (values: Record<string, unknown>): Record<string, string | number> => {
  const out: Record<string, string | number> = {}
  for (const key in values) {
    if (key === Projection.KEY || key === TEMPLATE_KEY) continue
    out[key] = values[key] as string | number
  }
  return out
}

/**
 * Whether a projection moves nothing (#443): no delta, no tree scale, no handover's rotation. A
 * templated element it draws is drawn as at a plain render then, as Motion's is once its projection
 * ends (`transformTemplate({}, "")` with no transform key), so a template is never handed `none`.
 */
const projectsNothing = (projection: Projection.Value): boolean => {
  const { delta, treeScale } = projection
  if (delta.x.translate !== 0 || delta.y.translate !== 0) return false
  if (delta.x.scale !== 1 || delta.y.scale !== 1) return false
  if (treeScale.x !== 1 || treeScale.y !== 1) return false
  return Predicate.isUndefined(projection.rotate)
}

/**
 * The transform keys a plain render draws (ADR-0023): each one present and not at its identity, in
 * the canonical order; `""` when every one present is at its identity; `undefined` with none. Built
 * by concatenation, not an array joined (ADR-0034): this runs per element per frame.
 */
const plainTransformOf = (values: Record<string, unknown>): string | undefined => {
  let transform = ""
  let separator = ""
  let present = false
  for (const { key, fn, identity } of TRANSFORM_FUNCS) {
    if (!Object.hasOwn(values, key)) continue
    present = true
    const value = values[key]
    if (isIdentity(value, identity)) continue
    transform = `${transform}${separator}${fn}(${formatTransformValue(key, value)})`
    separator = " "
  }
  if (!present) return undefined
  return transform
}

/**
 * The transform an element draws at a plain render, or `undefined` to leave its own: its template's,
 * called with no transform key too, as Motion's is (#443); else its keys', `none` when every one is
 * at its identity (ADR-0023), so a class's transform stays overridden and its last one doesn't stay
 * inline. Per frame: early returns.
 */
const drawnTransformOf = (values: Record<string, unknown>): string | undefined => {
  const template = templateOf(values)
  if (Predicate.isNotUndefined(template)) return templatedPlain(template, values)
  const transform = plainTransformOf(values)
  if (transform === "") return "none"
  return transform
}

/**
 * A templated element's transform at a plain render (#443): its template's, from its keys and the
 * transform Wardic would draw, `""` when that's nothing.
 */
const templatedPlain = (template: TransformTemplate, values: Record<string, unknown>): string => {
  const generated = plainTransformOf(values)
  if (Predicate.isUndefined(generated)) return template(templateValuesOf(values), "")
  return template(templateValuesOf(values), generated)
}

/**
 * The transform a projected element draws (ADR-0009): its projection's, through its template while
 * the projection moves it, and as at a plain render once nothing does (#443). Per frame: early returns.
 */
const projectedTransformOf = (projection: Projection.Value, values: Record<string, unknown>): string => {
  const template = templateOf(values)
  if (Predicate.isUndefined(template)) return buildProjectionTransform(projection.delta, projection.treeScale, values, projection.rotate)
  if (projectsNothing(projection)) return templatedPlain(template, values)
  return template(rawValuesOf(values), buildProjectionTransform(projection.delta, projection.treeScale, values, projection.rotate))
}

/**
 * The transform a measure holds an element at, as Motion's `transformTemplate(values, "")`: its
 * template's, with no transform of Wardic's, so a static part of it, centring say, is in the box
 * measured. `""` for an element with none, which the measure clears it to.
 */
// A Measure pass (#443). Tier 2, for binding authors.
export const heldTransformOf = (values: Readonly<Record<string, unknown>>): string => {
  const template = templateOf(values as Record<string, unknown>)
  if (Predicate.isUndefined(template)) return ""
  return template(rawValuesOf(values as Record<string, unknown>), "")
}

/** `translate3d`'s z argument: the element's own `z`, plus its `translateZ` in pixels when it has one (#363), else none. */
const zArgOf = (z: unknown, translateZ: unknown): string => {
  if (Predicate.isNotUndefined(translateZ)) return `${pxOf(z) + pxOf(translateZ)}px`
  if (Predicate.isUndefined(z)) return "0px"
  return formatTransformValue("z", z)
}

/**
 * The opacity a projection draws, or `undefined` to leave the user's own (ADR-0010): a Switch's
 * blended opacity as it is (*Amendment (#166)*), else the crossfade factor times the user's
 * opacity. Per frame: early returns.
 */
const projectedOpacity = (projection: Projection.Value, values: Record<string, unknown>): number | undefined => {
  if (Predicate.isNotUndefined(projection.blendOpacity)) return projection.blendOpacity
  if (Predicate.isUndefined(projection.opacity)) return undefined
  return numberOr(values.opacity, 1) * projection.opacity
}

/**
 * A Frame's values as a DOM style patch, pure. The transform keys become one `transform`, each left out
 * at its identity, and `none` when every one is; with no transform key there's no `transform`, so a
 * class's shows. A node's projection, when its values carry one under `Projection.KEY`, becomes its
 * transform instead, with the element's own move, rotation, skew and scale drawn on it. Every other key is
 * copied across, a bare number on a length in `px`. A binding's server render, which builds no runtime,
 * projects with it directly.
 *
 * @example
 * DomRenderer.project({ x: 0, scale: 1, width: 200 }) // { transform: "none", width: "200px" }
 */
// Two modes. PROJECTION (ADR-0009): the transform is assembled by `buildProjectionTransform` from the
// node's `delta`/`treeScale`, adding the element's own translate (`x`, `y`, `translate*`, #363), weaving
// its own animated `rotate`/`skew` and multiplying in its own `scale`/`scaleX`/`scaleY`. NORMAL: the
// value-spine path, `none` at every identity (ADR-0023). The same function `RendererDomLive` provides
// (ADR-0021, decision 2). Tier 2, for binding authors.
export const project = (values: Readonly<Record<string, unknown>>): Renderer.Patch => {
  const patch: Renderer.Patch = {}

  const projection = values[Projection.KEY] as Projection.Value | undefined
  if (Predicate.isNotUndefined(projection)) {
    // Projection owns the transform; weave this element's rotate/skew from `values`, through its
    // Transform template when it has one (#443).
    patch.transform = projectedTransformOf(projection, values)
    // Copy non-transform style keys (transform keys are consumed by the weave /
    // owned by the projection; the reserved keys never render).
    for (const key in values) {
      if (key === Projection.KEY || key === TEMPLATE_KEY || TRANSFORM_KEYS.has(key)) continue
      patch[key] = formatStyleValue(key, values[key])
    }
    // Shared-element crossfade (ADR-0010): compose the crossfade factor with the
    // user's opacity — `finalOpacity = (userOpacity ?? 1) × factor`. Pure: both
    // values are already in the value-map (like buildProjectionTransform above).
    // A Switch's blended opacity is drawn as it is (ADR-0010, *Amendment (#166)*).
    const opacity = projectedOpacity(projection, values)
    if (Predicate.isNotUndefined(opacity)) patch.opacity = opacity
    // A dragged node's raise (ADR-0016 *Amendment (Reorder)*): kebab-case, as the
    // scale correctors' keys are, so the commit's `setProperty` takes it.
    if (Predicate.isNotUndefined(projection.raise)) patch["z-index"] = projection.raise
    // A Follower takes no pointer input (`Projection`'s `passesPointer`, ADR-0010, *Amendment
    // (#165)*; Motion's): `pointer-events: none`. A Lead's write leaves the key out, and the gate
    // gives the element its own value back.
    if (projection.passesPointer === true) patch["pointer-events"] = "none"
    return patch
  }

  // Grouped transform: the present keys in the canonical order, through the Transform template
  // when the element has one (#443).
  const transform = drawnTransformOf(values)
  if (Predicate.isNotUndefined(transform)) patch.transform = transform

  // Non-transform keys: copy across with default-unit handling.
  for (const key in values) {
    if (key === TEMPLATE_KEY || TRANSFORM_KEYS.has(key)) continue
    patch[key] = formatStyleValue(key, values[key])
  }

  return patch
}

/**
 * Imperative: write a `Patch` onto `target`, now. The engine treats `target` as
 * opaque; the DOM renderer narrows it to an `HTMLElement`/`SVGElement`. CSS keys go
 * through `setProperty` (dash-cased so `transform-box` etc. apply — `el.style[kebab]=`
 * silently fails). An svg-inner element's patch is routed first (ADR-0014,
 * {@link splitPatch}): its attribute keys via `setAttribute`.
 *
 * On the per-frame path (ADR-0034): an HTML element's patch is written as it is, with no
 * routing objects, and each key's dash-cased name is cached. Quiet — no span/log.
 */
const commit = (target: unknown, patch: Renderer.Patch): void => {
  const el = target as Element & { style: CSSStyleDeclaration }
  if (isSvgInner(el)) {
    const { style, attrs } = splitPatch(el, patch)
    writeStyle(el.style, style)
    setSvgAttrs(el, attrs)
    return
  }
  writeStyle(el.style, patch)
}

/** Each key of `patch` onto `style`, through `setProperty`. */
const writeStyle = (style: CSSStyleDeclaration, patch: Record<string, unknown>): void => {
  for (const key in patch) style.setProperty(dashCase(key), String(patch[key]))
}

/** Core's `Renderer` for the DOM: `project` and a `commit` that writes a patch onto an element's style. It needs nothing. */
// `project` and `commit` have no service dependencies, so this is a plain `Layer.succeed`.
export const RendererDomLive: Layer.Layer<Renderer.Renderer> = Layer.succeed(Renderer.Renderer, { project, commit })
