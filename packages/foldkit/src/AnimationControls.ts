/**
 * **Animation controls** on Foldkit (#433, Motion's `useAnimationControls`; #798, Q2–Q4, Q13 and Q18):
 * made apart from any element with {@link make}, at module scope or in the Model's making, and given to
 * any number of `w.*` elements as `w.Animate(controls)` (the bundle's `animate` too). {@link start}
 * animates each to a definition as a change of its `Animate` would, its Variant children following, as
 * an Effect for a Command: it succeeds once they have landed, and interrupting it stops them where
 * they are. `controls.set(definition)` lands them at once and `controls.stop()` ends them where they
 * are, both synchronous, run from `Effect.sync` in a Command. An element hears the controls it mounted
 * with, until it unmounts.
 *
 * @example
 * const controls = AnimationControls.make()
 * // in the view
 * w.ul([w.Initial("hidden"), w.Animate(controls), w.Variants(list)], items)
 * // in a Command
 * const Open = Command.define("Open", { messages: [Message.Opened], execute: AnimationControls.start(controls, "visible").pipe(Effect.as(Message.Opened())) })
 *
 * @module
 */
import * as CoreControls from "@wardic/core/unstable/AnimationControls"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as Effect from "effect/Effect"

/** The controls: `start(definition, transition?)`, `set(definition)` and `stop()`, over every element given them. */
export type AnimationControls = CoreControls.WardicAnimationControls

/** What a start or set animates to (Motion's): a variant name, or names, a target's values, or a function of the element's `Custom`, values and velocities, called once per element. */
export type Definition = CoreControls.WardicControlsDefinition

/** Makes animation controls (Motion's `useAnimationControls`): needs no element, and outlives the elements given them. */
export const make: () => AnimationControls = CoreControls.createAnimationControls

// #798, Q3, Q13 and Q18: core's promise as an Effect, interruption as the controls' stop. No `Wardic`
// service: the controls reach elements through their Mounts.
/**
 * Animates every element given `controls`, and its Variant children, to `definition`, as a change of
 * its `Animate` would (an `Effect` for a Command): `transition`, when given, is the transition of this
 * change over the definition's own, and its stagger. Succeeds once each element and its children have
 * landed, at once with no element given the controls; interrupting it ends every element the controls
 * reach where it is, as `controls.stop()` does.
 */
export const start = (controls: AnimationControls, definition: Definition, transition?: WardConfig.WardicTransition): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    void controls.start(definition, transition).then(() => resume(Effect.void))
    return Effect.sync(() => controls.stop())
  })
