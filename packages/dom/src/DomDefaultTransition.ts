/**
 * The DOM's Default transition: Motion's by value, its springs for the transforms and a 0.3 s ease
 * for the rest (ADR-0051, #357), and its 0.8 s tween through more than two keyframes (#429).
 *
 * `@wardic/dom/DomDefaultTransition` (#132, ADR-0041).
 */
export {
  DefaultTransitionDomLive as layer,
  keyframes,
  transitionFor,
} from "./internal/default-transition.ts"
