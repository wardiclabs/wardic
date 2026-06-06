/**
 * Scale-correction registry (ADR-0011) — the visual-correction half of the
 * projection (ADR-0009). A scaling projection counter-scales an element's
 * geometry via the transform, but non-geometric CSS — `border-radius`,
 * `box-shadow` — is still distorted by that scale. Each {@link ScaleCorrector}
 * reads the element's base value at measure time and, per frame, emits a CSS
 * string that — once the transform scales it — renders as the AUTHORED value.
 *
 * The projection coordinator owns the pipeline (it has the element + the per-frame
 * `delta`/`treeScale`); the corrected value is written into the node's gate entry
 * as an ordinary style key, so the Renderer stays pure (ADR-0002/0006) — it just
 * applies what the projection computed.
 *
 * Units: `getComputedStyle` resolves em/rem/etc. to px, leaving only **px**
 * (corrected via `/scale`) and **`%`** (self-correcting — a percentage stays the
 * same fraction of each scaled dimension, so it passes through). Reading resolved
 * values therefore gives full-grammar parity.
 */

/** A registered scale corrector — owns reading its base + emitting the corrected value. */
export interface ScaleCorrector {
  /** The gate value-map / CSS key the corrected value is written under. */
  readonly key: string
  /**
   * Read the element's base value(s) at measure time (read phase), or `undefined`
   * if there is nothing to correct (e.g. radius all `0px`, shadow `none`).
   */
  readonly read: (el: HTMLElement) => unknown
  /** Emit the corrected CSS string for the per-axis visual scale `(sx, sy)`. */
  readonly correct: (base: unknown, sx: number, sy: number) => string
}

const EPS = 1e-3
/** Whether a per-axis scale is ~identity (no correction needed). */
export const isUnitScale = (sx: number, sy: number): boolean => Math.abs(sx - 1) < EPS && Math.abs(sy - 1) < EPS

// --- border-radius -----------------------------------------------------------

/** One corner's horizontal + vertical radius as authored strings (px or %). */
interface CornerRadius {
  readonly h: string
  readonly v: string
}
/** The four corners, in CSS order: top-left, top-right, bottom-right, bottom-left. */
type RadiusBase = readonly [CornerRadius, CornerRadius, CornerRadius, CornerRadius]

const CORNER_PROPS = [
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
] as const

/** Parse a computed longhand (`"H V"` or `"H"`) into its H + V components. */
const parseCorner = (computed: string): CornerRadius => {
  const parts = computed.trim().split(/\s+/)
  const h = parts[0] ?? "0px"
  return { h, v: parts[1] ?? h } // a single value is circular (H === V)
}

/** Whether every corner is zero (nothing to correct). */
const isZeroRadius = (base: RadiusBase): boolean =>
  base.every((c) => (Number.parseFloat(c.h) || 0) === 0 && (Number.parseFloat(c.v) || 0) === 0)

/**
 * Correct one radius component for `scale`. A `%` is self-correcting (a fraction
 * of each scaled dimension) and passes through; a px value is divided by the
 * scale so the transform renders it back to the authored px.
 */
const correctRadiusComponent = (value: string, scale: number): string => {
  if (value.endsWith("%")) return value
  const px = Number.parseFloat(value)
  if (!Number.isFinite(px)) return value
  return `${px / scale}px`
}

export const borderRadiusCorrector: ScaleCorrector = {
  // Kebab-case: corrected values flow through the gate's style object, which the
  // binding applies via `el.style.setProperty` — that requires hyphenated names
  // (a camelCase key is silently dropped). `transform`/`opacity` work either way.
  key: "border-radius",
  read: (el) => {
    const cs = getComputedStyle(el)
    const base = CORNER_PROPS.map((p) => parseCorner((cs[p] as string) || "0px")) as unknown as RadiusBase
    return isZeroRadius(base) ? undefined : base
  },
  correct: (base, sx, sy) => {
    const corners = base as RadiusBase
    const h = corners.map((c) => correctRadiusComponent(c.h, sx)).join(" ")
    const v = corners.map((c) => correctRadiusComponent(c.v, sy)).join(" ")
    // Elliptical shorthand: horizontal radii / vertical radii.
    return `${h} / ${v}`
  },
}

// --- box-shadow --------------------------------------------------------------

/** One parsed shadow layer: the verbatim color, the px lengths, and inset flag. */
interface ShadowLayer {
  readonly color: string
  readonly offsetX: number
  readonly offsetY: number
  readonly blur: number
  readonly spread: number
  readonly inset: boolean
  /** How many length tokens were authored (2–4), to round-trip the shape faithfully. */
  readonly lengthCount: number
}

/** Split a `box-shadow` value into layers on TOP-LEVEL commas (ignoring `rgb(…)` commas). */
const splitLayers = (value: string): Array<string> => {
  const layers: Array<string> = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (ch === "," && depth === 0) {
      layers.push(value.slice(start, i))
      start = i + 1
    }
  }
  layers.push(value.slice(start))
  return layers
}

/** Tokenise a layer, keeping parenthesised groups (e.g. `rgb(0, 0, 0)`) intact. */
const tokenizeLayer = (layer: string): Array<string> => {
  const tokens: Array<string> = []
  let depth = 0
  let cur = ""
  for (const ch of layer.trim()) {
    if (ch === "(") depth++
    else if (ch === ")") depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur !== "") tokens.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur !== "") tokens.push(cur)
  return tokens
}

const isLength = (t: string): boolean => Number.isFinite(Number.parseFloat(t))

const parseLayer = (layer: string): ShadowLayer | undefined => {
  const tokens = tokenizeLayer(layer)
  if (tokens.length === 0) return undefined
  let inset = false
  const lengths: Array<number> = []
  let color = ""
  for (const t of tokens) {
    if (t === "inset") inset = true
    else if (isLength(t)) lengths.push(Number.parseFloat(t))
    else color = t // a non-length, non-inset token is the color (verbatim)
  }
  if (lengths.length < 2) return undefined // offsetX + offsetY are required
  return {
    color,
    offsetX: lengths[0]!,
    offsetY: lengths[1]!,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    inset,
    lengthCount: lengths.length,
  }
}

const formatLayer = (l: ShadowLayer, sx: number, sy: number): string => {
  const mean = (sx + sy) / 2
  // Per-axis offsets exact; blur + spread are scalar -> axis mean (no exact value
  // under non-uniform scale).
  const lens = [l.offsetX / sx, l.offsetY / sy, l.blur / mean, l.spread / mean]
    .slice(0, l.lengthCount)
    .map((n) => `${n}px`)
  const parts: Array<string> = []
  if (l.inset) parts.push("inset")
  parts.push(...lens)
  if (l.color !== "") parts.push(l.color)
  return parts.join(" ")
}

export const boxShadowCorrector: ScaleCorrector = {
  key: "box-shadow", // kebab-case (see borderRadiusCorrector.key)
  read: (el) => {
    const value = getComputedStyle(el).boxShadow
    if (value === "" || value === "none") return undefined
    const layers = splitLayers(value)
      .map(parseLayer)
      .filter((l): l is ShadowLayer => l !== undefined)
    return layers.length > 0 ? layers : undefined
  },
  correct: (base, sx, sy) => (base as Array<ShadowLayer>).map((l) => formatLayer(l, sx, sy)).join(", "),
}

/**
 * The default scale-corrector registry (ADR-0011). Ship `borderRadius` +
 * `boxShadow`; a public `addScaleCorrector` API is a deferred follow-up (adding
 * an entry here is the extension point until then).
 */
export const SCALE_CORRECTORS: ReadonlyArray<ScaleCorrector> = [borderRadiusCorrector, boxShadowCorrector]
