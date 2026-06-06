/**
 * `RendererDomLive` — the browser realization of `Renderer` (ADR-0002).
 *
 * Split into the two halves the contract mandates:
 *
 *   - {@link project} — PURE, synchronous: translates engine values into a DOM
 *     `Patch`. Its one piece of real work is grouping the individual transform
 *     keys (`x`/`y`/`scale`/`rotate`/…) into a single CSS `transform` string in
 *     a canonical order, and applying default units (px/deg) to bare numbers.
 *     Reused by the reactive Solid path so this grouping/unit logic isn't
 *     duplicated in the binding (ADR-0002). No side effects, no Effect.
 *   - {@link commit} — imperative: writes each `Patch` entry onto `target.style`.
 *     Used only by the imperative path (`applyTo`, `createAnimate`, `use:ward`).
 *
 * Observability (CONTEXT.md convention): `project` and `commit` are the
 * per-frame hot path, so — exactly like core's `applyTo` per-frame writes and
 * the Clock's `tick` — they stay quiet (no span, no per-call log).
 */
import { type Delta, type Patch, type Point, PROJECTION_KEY, type ProjectionValue, Renderer } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * CSS transform functions in their canonical emission order: translate group,
 * then scale, then rotate, then skew. `project` walks this list and emits a
 * func for each key that is present in `values`, so the resulting `transform`
 * string is always grouped in this order regardless of input key order.
 *
 * `key` is the property name accepted on engine values (shorthands `x`/`y`/`z`
 * included); `fn` is the CSS function name it renders as.
 */
const TRANSFORM_FUNCS: ReadonlyArray<{ readonly key: string; readonly fn: string }> = [
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
]

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

/** Fast membership test for "is this key a transform key?". */
const TRANSFORM_KEYS: ReadonlySet<string> = new Set(Object.keys(TRANSFORM_UNITS))

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
 * scale. Translate + scale are intentionally absent — the projection OWNS them,
 * so a layout element's animated `x`/`y`/`scale` are ignored (projection drives
 * those). `z` is folded into the projection's `translate3d` (handled inline).
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
 * Assemble a projection transform string (ADR-0009), ported from Motion's
 * `buildProjectionTransform`: `translate3d` (translation divided by `treeScale`)
 * → inverse tree-scale `scale(1/treeScale)` → woven user `rotate`/`skew` (from
 * `latest`, the element's value-map) → element `scale(delta.scale × treeScale)`.
 * Each term is emitted only when it is non-identity; with nothing to emit the
 * result is `"none"` (an identity projection carrying no woven transform).
 */
const buildProjectionTransform = (delta: Delta, treeScale: Point, latest: Record<string, unknown>): string => {
  const funcs: Array<string> = []

  const tx = delta.x.translate / treeScale.x
  const ty = delta.y.translate / treeScale.y
  const z = latest["z"]
  if (tx !== 0 || ty !== 0 || (z !== undefined && z !== 0)) {
    const zArg = z === undefined ? "0px" : formatTransformValue("z", z)
    funcs.push(`translate3d(${tx}px, ${ty}px, ${zArg})`)
  }

  if (treeScale.x !== 1 || treeScale.y !== 1) {
    funcs.push(`scale(${1 / treeScale.x}, ${1 / treeScale.y})`)
  }

  for (const { key, fn } of PROJECTION_WOVEN) {
    if (Object.hasOwn(latest, key)) funcs.push(`${fn}(${formatTransformValue(key, latest[key])})`)
  }

  const sx = delta.x.scale * treeScale.x
  const sy = delta.y.scale * treeScale.y
  if (sx !== 1 || sy !== 1) funcs.push(`scale(${sx}, ${sy})`)

  return funcs.length > 0 ? funcs.join(" ") : "none"
}

/**
 * PURE: translate engine values into a DOM `Patch`. Two modes:
 *
 *   - PROJECTION (ADR-0009): when the reserved {@link PROJECTION_KEY} is present,
 *     the transform is assembled by {@link buildProjectionTransform} from that
 *     node's `delta`/`treeScale`, weaving the element's own animated
 *     `rotate`/`skew` (read from the same value-map). The element's `x`/`y`/`scale`
 *     transform keys are skipped — the projection owns translate + scale.
 *   - NORMAL: group all present transform keys into one canonical `transform`
 *     string (the value-spine path).
 *
 * Either way, non-transform keys are copied across with default-unit handling.
 * No side effects.
 */
const project = (values: Record<string, unknown>): Patch => {
  const patch: Patch = {}

  const projection = values[PROJECTION_KEY] as ProjectionValue | undefined
  if (projection !== undefined) {
    // Projection owns the transform; weave this element's rotate/skew from `values`.
    patch.transform = buildProjectionTransform(projection.delta, projection.treeScale, values)
    // Copy non-transform style keys (transform keys are consumed by the weave /
    // owned by the projection; the projection key itself never renders).
    for (const key in values) {
      if (key === PROJECTION_KEY || TRANSFORM_KEYS.has(key)) continue
      patch[key] = formatStyleValue(key, values[key])
    }
    // Shared-element crossfade (ADR-0010): compose the crossfade factor with the
    // user's opacity — `finalOpacity = (userOpacity ?? 1) × factor`. Pure: both
    // values are already in the value-map (like buildProjectionTransform above).
    if (projection.opacity !== undefined) {
      const user = typeof values.opacity === "number" ? values.opacity : 1
      patch.opacity = user * projection.opacity
    }
    return patch
  }

  // Grouped transform: walk the canonical order, emitting a func per present key.
  const funcs: Array<string> = []
  for (const { key, fn } of TRANSFORM_FUNCS) {
    if (Object.hasOwn(values, key)) {
      funcs.push(`${fn}(${formatTransformValue(key, values[key])})`)
    }
  }
  if (funcs.length > 0) patch.transform = funcs.join(" ")

  // Non-transform keys: copy across with default-unit handling.
  for (const key in values) {
    if (TRANSFORM_KEYS.has(key)) continue
    patch[key] = formatStyleValue(key, values[key])
  }

  return patch
}

/**
 * Imperative: write each `Patch` entry onto `target.style`. The engine treats
 * `target` as opaque; the DOM renderer narrows it to something carrying a
 * `style` object (an `HTMLElement`). Quiet per-frame hot path — no span/log.
 */
const commit = <T>(target: T, patch: Patch): Effect.Effect<void> =>
  Effect.sync(() => {
    const el = target as { style: Record<string, string> }
    for (const key in patch) {
      el.style[key] = String(patch[key])
    }
  })

/**
 * `Renderer` Layer for the browser. `project`/`commit` are pure/simple with no
 * service dependencies, so this is a plain `Layer.succeed` — no `AtomRegistry`
 * or other Environment service is required.
 */
export const RendererDomLive: Layer.Layer<Renderer> = Layer.succeed(Renderer, { project, commit })
