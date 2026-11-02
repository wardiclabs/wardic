/**
 * The DOM's `Renderer`: a Frame's values projected into a style patch (`project`) and committed onto an element, the own transform and opacity an element's values carry, its **Transform template** (ADR-0006, ADR-0034, #443), and the CSS lengths a bare number is drawn in `px` on (`LENGTH_KEYS`, #522).
 *
 * `@wardic/dom/DomRenderer` (#132, ADR-0041).
 */
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
