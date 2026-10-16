/**
 * The DOM's `Renderer`: a Frame's values projected into a style patch (`project`) and committed onto an element, and the own transform and opacity an element's values carry (ADR-0006, ADR-0034).
 *
 * `@wardic/dom/DomRenderer` (#132, ADR-0041).
 */
export {
  RendererDomLive as layer,
  project,
  ownScaleOf,
  ownRotateOf,
  ownOpacityOf,
} from "./internal/renderer.ts"
