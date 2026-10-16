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
import * as Layer from "effect/Layer"

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
const TRANSFORM_FUNCS: ReadonlyArray<{ readonly key: string; readonly fn: string; readonly identity: number }> = [
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
  // rotate group
  { key: "rotate", fn: "rotate" },
  { key: "rotateX", fn: "rotateX" },
  { key: "rotateY", fn: "rotateY" },
  { key: "rotateZ", fn: "rotateZ" },
  // skew group
  { key: "skewX", fn: "skewX" },
  { key: "skewY", fn: "skewY" },
].map((f) => ({ ...f, identity: BaseValue.TRANSFORM_IDENTITY[f.key]! }))

/**
 * Whether a transform value is at its identity (ADR-0023), Motion's test
 * (motion-dom build-transform.ts:42-48 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8):
 * a number equal to it, or a string `parseFloat` takes to it (`"0px"`, `"0%"`,
 * `"0deg"`; never `"calc(0px)"` or `"var(--x)"`). Exact: a settled spring lands on
 * its target, and a value next to the identity mid-flight is still written.
 */
const isIdentity = (value: unknown, identity: number): boolean =>
  typeof value === "number" ? value === identity : typeof value === "string" && Number.parseFloat(value) === identity

/** Default unit appended to a bare numeric transform value, by transform key. */
type TransformUnit = "px" | "deg" | ""

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
 * Non-transform CSS properties that take a length: a bare number is rendered
 * with a `px` suffix. Anything not in this set (`opacity`, `zIndex`, custom
 * unitless numerics) keeps its raw number; string values always pass through
 * verbatim regardless of key.
 */
const LENGTH_KEYS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontSize",
  "borderRadius",
  "borderWidth",
  "gap",
  "rowGap",
  "columnGap",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "lineHeight",
  "letterSpacing",
  "translateX",
  "translateY",
])

/**
 * Format one transform value into its CSS func argument. Strings pass through
 * verbatim (explicit units respected); numbers get the key's default unit.
 */
const formatTransformValue = (key: string, value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number") return `${value}${TRANSFORM_UNITS[key] ?? ""}`
  return String(value)
}

/**
 * Format one non-transform value. Strings pass through verbatim; numbers on a
 * known length key get `px`; every other number stays raw (unitless).
 */
const formatStyleValue = (key: string, value: unknown): unknown => {
  if (typeof value === "number" && LENGTH_KEYS.has(key)) return `${value}px`
  return value
}

/**
 * User-animated transform funcs woven INTO a projection transform (ADR-0009,
 * Motion's `buildProjectionTransform`): `rotate`/`skew` compose with a layout
 * projection and are emitted between the inverse-tree-scale and the element
 * scale, each left out at its identity, 0 (ADR-0009 *Amendment (#57)*). Translate is intentionally absent — the projection OWNS it, so a layout
 * element's animated `x`/`y` are ignored (ADR-0016: a drag feeds the projection).
 * The element's own `scale`/`scaleX`/`scaleY` multiply the element scale instead
 * (see {@link ownScale}). `z` is folded into the projection's `translate3d`
 * (handled inline).
 */
const PROJECTION_WOVEN: ReadonlyArray<{ readonly key: string; readonly fn: string }> = [
  { key: "rotate", fn: "rotate" },
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
const ownScale = (latest: Record<string, unknown>, axisKey: "scaleX" | "scaleY"): number => {
  const both = latest.scale
  const axis = latest[axisKey]
  return (typeof both === "number" ? both : 1) * (typeof axis === "number" ? axis : 1)
}

/**
 * An element's own scale per axis, from its value-map: what the renderer draws on top of its
 * projection ({@link ownScale}). A binding hands it to its projection node (`ownScale`), so a
 * handover starts from where a twin is drawn and a Follower is drawn where its Lead is (ADR-0010
 * *Amendment (#8)*). Tier 2, for binding authors.
 */
export const ownScaleOf = (values: Record<string, unknown>): Point.Point => ({
  x: ownScale(values, "scaleX"),
  y: ownScale(values, "scaleY"),
})

/**
 * An element's own `rotate` in degrees, from its value-map: what the renderer weaves into its
 * projection, 0 for an absent or non-numeric value. A binding hands it to its projection node
 * (`ownRotate`), so a handover blends from a twin's rotation into its own (ADR-0010 *Amendment
 * (#166)*). Tier 2, for binding authors.
 */
export const ownRotateOf = (values: Record<string, unknown>): number => {
  const rotate = values.rotate
  if (typeof rotate === "number") return rotate
  return 0
}

/**
 * An element's own opacity, from its value-map: what the renderer draws, 1 for an absent or
 * non-numeric value. A binding hands it to its projection node (`ownOpacity`), so a Switch blends
 * from the leaver's opacity into it (ADR-0010 *Amendment (#166)*). Tier 2, for binding authors.
 */
export const ownOpacityOf = (values: Record<string, unknown>): number => {
  const opacity = values.opacity
  if (typeof opacity === "number") return opacity
  return 1
}

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
  latest: Record<string, unknown>,
  rotate: number | undefined,
): string => {
  const funcs: Array<string> = []

  const tx = delta.x.translate / treeScale.x
  const ty = delta.y.translate / treeScale.y
  const z = latest["z"]
  if (tx !== 0 || ty !== 0 || (z !== undefined && !isIdentity(z, 0))) {
    const zArg = z === undefined ? "0px" : formatTransformValue("z", z)
    funcs.push(`translate3d(${tx}px, ${ty}px, ${zArg})`)
  }

  if (treeScale.x !== 1 || treeScale.y !== 1) {
    funcs.push(`scale(${1 / treeScale.x}, ${1 / treeScale.y})`)
  }

  for (const { key, fn } of PROJECTION_WOVEN) {
    // A handover's blended rotation stands in for the element's own (ADR-0010, *Amendment (#166)*).
    if (key === "rotate" && rotate !== undefined) {
      if (rotate !== 0) funcs.push(`rotate(${formatTransformValue(key, rotate)})`)
      continue
    }
    if (Object.hasOwn(latest, key) && !isIdentity(latest[key], 0)) funcs.push(`${fn}(${formatTransformValue(key, latest[key])})`)
  }

  const sx = delta.x.scale * treeScale.x * ownScale(latest, "scaleX")
  const sy = delta.y.scale * treeScale.y * ownScale(latest, "scaleY")
  if (sx !== 1 || sy !== 1) funcs.push(`scale(${sx}, ${sy})`)

  return funcs.length > 0 ? funcs.join(" ") : "none"
}

/**
 * PURE: translate engine values into a DOM `Patch`. Two modes:
 *
 *   - PROJECTION (ADR-0009): when the reserved `Projection.KEY` is present,
 *     the transform is assembled by {@link buildProjectionTransform} from that
 *     node's `delta`/`treeScale`, weaving the element's own animated
 *     `rotate`/`skew` and multiplying in its own `scale`/`scaleX`/`scaleY` (read
 *     from the same value-map). The element's `x`/`y` are skipped — the projection
 *     owns translate.
 *   - NORMAL: group all present transform keys into one canonical `transform`
 *     string (the value-spine path), leaving out each at its identity; with
 *     every one at its identity, `none` (ADR-0023). With no transform key, no
 *     `transform`, so a class's shows.
 *
 * Either way, non-transform keys are copied across with default-unit handling.
 * No side effects.
 *
 * Exported for a binding's server render, which builds no runtime and so projects with
 * this function directly: the same one {@link RendererDomLive} provides (ADR-0021,
 * decision 2). Tier 2, for binding authors.
 */
export const project = (values: Record<string, unknown>): Renderer.Patch => {
  const patch: Renderer.Patch = {}

  const projection = values[Projection.KEY] as Projection.Value | undefined
  if (projection !== undefined) {
    // Projection owns the transform; weave this element's rotate/skew from `values`.
    patch.transform = buildProjectionTransform(projection.delta, projection.treeScale, values, projection.rotate)
    // Copy non-transform style keys (transform keys are consumed by the weave /
    // owned by the projection; the projection key itself never renders).
    for (const key in values) {
      if (key === Projection.KEY || TRANSFORM_KEYS.has(key)) continue
      patch[key] = formatStyleValue(key, values[key])
    }
    // Shared-element crossfade (ADR-0010): compose the crossfade factor with the
    // user's opacity — `finalOpacity = (userOpacity ?? 1) × factor`. Pure: both
    // values are already in the value-map (like buildProjectionTransform above).
    // A Switch's blended opacity is drawn as it is (ADR-0010, *Amendment (#166)*).
    if (projection.blendOpacity !== undefined) {
      patch.opacity = projection.blendOpacity
    } else if (projection.opacity !== undefined) {
      const user = typeof values.opacity === "number" ? values.opacity : 1
      patch.opacity = user * projection.opacity
    }
    // A dragged node's raise (ADR-0016 *Amendment (Reorder)*): kebab-case, as the
    // scale correctors' keys are, so the commit's `setProperty` takes it.
    if (projection.raise !== undefined) patch["z-index"] = projection.raise
    // A Follower takes no pointer input (ADR-0010, *Amendment (#165)*; Motion's): a Lead's
    // write leaves the key out, and the gate gives the element its own value back.
    if (projection.passesPointer === true) patch["pointer-events"] = "none"
    return patch
  }

  // Grouped transform: walk the canonical order, emitting a func per present key not at
  // its identity. `none` when every present key is (ADR-0023): written, so a class's
  // transform stays overridden and an element's last transform doesn't stay inline.
  // Built by concatenation, not an array joined (ADR-0034): this runs per element per frame.
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
  if (present && transform === "") transform = "none"
  if (present) patch.transform = transform

  // Non-transform keys: copy across with default-unit handling.
  for (const key in values) {
    if (TRANSFORM_KEYS.has(key)) continue
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

/**
 * `Renderer` Layer for the browser. `project`/`commit` are pure/simple with no
 * service dependencies, so this is a plain `Layer.succeed` — no `AtomRegistry`
 * or other Environment service is required.
 */
export const RendererDomLive: Layer.Layer<Renderer.Renderer> = Layer.succeed(Renderer.Renderer, { project, commit })
