/**
 * The DOM's Default transition, Motion's by value: a spring for the transforms, a 0.3 s ease for the
 * rest, and a 0.8 s tween through more than two keyframes. `layer` is what `DomLive` provides.
 *
 * @example
 * import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
 *
 * DomDefaultTransition.transitionFor("x", 100) // { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 }
 * DomDefaultTransition.transitionFor("opacity", 1) // a 0.3 s tween
 */
// `@wardic/dom/DomDefaultTransition` (#132, ADR-0041): ADR-0051, #357; keyframes #429.
export {
  DefaultTransitionDomLive as layer,
  keyframes,
  transitionFor,
} from "./internal/default-transition.ts"
