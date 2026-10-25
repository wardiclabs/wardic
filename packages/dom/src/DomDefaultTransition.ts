/**
 * The DOM's Default transition: Motion's by value, its springs for the transforms and a 0.3 s ease
 * for the rest (ADR-0051, #357).
 *
 * `@wardic/dom/DomDefaultTransition` (#132, ADR-0041).
 */
export {
  DefaultTransitionDomLive as layer,
  transitionFor,
} from "./internal/default-transition.ts"
