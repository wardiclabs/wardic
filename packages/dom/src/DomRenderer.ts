/**
 * The DOM's Renderer: `project` turns a Frame's values into a style patch, grouping the transform keys
 * into one `transform` and drawing a bare number on a length in `px`, and its `commit` writes the patch
 * onto an element. The rest is for a binding's layout projection: an element's own move, scale, rotation
 * and opacity, read from its values, and its transform template.
 *
 * @example
 * import * as DomRenderer from "@wardic/dom/DomRenderer"
 *
 * DomRenderer.project({ x: 100, opacity: 0.5 }) // { transform: "translateX(100px)", opacity: 0.5 }
 */
// `@wardic/dom/DomRenderer` (#132, ADR-0041): ADR-0006, ADR-0034; the **Transform template** (#443);
// `LENGTH_KEYS` (#522).
export {
  RendererDomLive as layer,
  project,
  ownScaleOf,
  ownTranslateOf,
  ownRotateOf,
  ownOpacityOf,
  TEMPLATE_KEY,
  type TransformTemplate,
  heldTransformOf,
  LENGTH_KEYS,
  type LengthKey,
} from "./internal/renderer.ts"
