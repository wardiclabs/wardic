/**
 * The keys of the binding's own Features (#792; ADR-0067 decision 3's pattern, dom's `features/Keys`):
 * what an element looks a Feature's service up by, in a module of their own, so the code that uses a
 * Feature imports no Feature's code, and an app that never gives the Feature ships none of it.
 *
 * @module
 */
import * as Context from "effect/Context"
import type * as PresenceController from "@wardic/dom/unstable/PresenceController"

/** What the `presence` Feature gives: dom's presence controller, its events and its `propagate`. */
export interface PresenceMakerShape {
  readonly make: (options: PresenceController.PresenceOptions) => PresenceController.PresenceController
  readonly events: typeof PresenceController.exitCompleteEvents
  readonly propagateTo: typeof PresenceController.propagateTo
}

/** The `presence` Feature's service (#792, Q9): what a `w.Presence` element's Mount makes its controller with. */
export class PresenceMaker extends Context.Service<PresenceMaker, PresenceMakerShape>()("@wardic/foldkit/PresenceMaker") {}
