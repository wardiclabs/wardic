/**
 * The DOM's Interpolators as a server render runs them: what its Appear animations sample and its
 * `createTransform`s map with (a server projects with the DOM's `project`, ADR-0021 decision 2). Built
 * from `DomInterpolators.layer` on first use, and kept: one while no colour spaces are registered, one
 * after. The `colors` Feature registers its spaces for the whole process (`Color.registerSpaces`), and a
 * registry keeps the blends it resolved by their strings, so one kept from before would blend `oklch()`
 * as it's written for every render after (FS3, FV2). Registering is one way, so two are all it takes.
 */
// #618 (M6): each Appear element, each of its Blend legs and each server `createTransform` built the
// Layer again: 4.7 µs a call, against 1.5 with one context (Bun).
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Color from "@wardic/dom/Color"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"

// Module state (#460, Q7): a server's Interpolators, the same for every request, by whether the colour
// spaces were registered when they were built. Nothing registers on them here; what they keep is a
// bounded cache of blends by their strings, which is the same for every request in either state.
const kept = new Map<boolean, Context.Context<InterpolatorRegistry.InterpolatorRegistry>>()

/** `effect` with a server render's Interpolators, for the colour spaces registered now. */
export const withServerInterpolators = <A, E>(effect: Effect.Effect<A, E, InterpolatorRegistry.InterpolatorRegistry>): Effect.Effect<A, E> => {
  const registered = Color.spacesRegistered()
  let context = kept.get(registered)
  if (Predicate.isUndefined(context)) {
    context = Effect.runSync(Effect.scoped(Layer.build(DomInterpolators.layer)))
    kept.set(registered, context)
  }
  return Effect.provideContext(effect, context)
}
