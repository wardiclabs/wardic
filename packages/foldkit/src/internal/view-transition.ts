/**
 * View Transitions on Foldkit (ADR-0071 decision 33; P10): `wardic.viewTransition(decide)` wraps the
 * app's `viewTransition` predicate. Foldkit calls it before each live render; when it transitions the
 * render (`true`, or `{ types }`), the wrapper arms the Handle's next layout delivery to run its pass as
 * an Instant change, so layout moves and `layoutId` handovers land at once and the View Transition's
 * morph carries the motion. Retargets in that render animate as usual. Where the document has no
 * `startViewTransition`, Foldkit renders plainly and the wrapper arms nothing, so Wardic animates the
 * moves itself. The decision passes through unchanged.
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import type * as Runtime from "foldkit/runtime"
import type { State } from "./services.ts"

/** Whether the document can transition a render: feature-detected once, at the first decision, as Foldkit's runtime detects it once. */
// Module state (#460, Q7): the detection, held once made; `undefined` until a decision asks.
let supported: boolean | undefined

const supportedNow = (): boolean => {
  if (Predicate.isNotUndefined(supported)) return supported
  supported = Predicate.isFunction((document as Document & { readonly startViewTransition?: unknown }).startViewTransition)
  return supported
}

/** The Handle's `viewTransition` (above): `decide`, with a transitioning decision arming the next layout delivery. */
export const viewTransitionOf =
  (state: State) =>
  <Model, Message>(decide: Runtime.ViewTransitionConfig<Model, Message>): Runtime.ViewTransitionConfig<Model, Message> =>
  (context) => {
    const decision = decide(context)
    // Every render decides afresh: a transitioned render that changed nothing of the layout's leaves no arming behind.
    state.transitioning = Bool.and(decision !== false, supportedNow())
    return decision
  }
