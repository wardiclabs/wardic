/**
 * The `FrameLoop` module (ADR-0027): the one loop per Environment that steps every running
 * Primitive once per tick, in one pass. A binding runs its Primitives on it with
 * `Machine.run(sink)` rather than one fiber per animation; a Primitive's `Stream` (Tier 2,
 * `Machine.toStream`) runs the same machine on its own. Its shape and `make` are internal
 * (ADR-0028, decision 11).
 *
 * A dev check for non-finite Frames, `CheckFrames`, is off by default: an app turns it on in
 * development on the Environment it hands its provider, and a NaN or an Infinity a step produces
 * then fails its run with `NonFiniteFrame` (ADR-0030, decision 7).
 *
 * Tier 2 (ADR-0008): Effect-typed, for binding and Environment authors.
 */
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as internal from "./internal/frameLoop.ts"

export { CheckFrames, NonFiniteFrame } from "./internal/frameLoop.ts"

/**
 * Where a run's Frames go: a plain call, never an Effect. Its return type is `undefined`, so a
 * sink that returns an Effect doesn't compile, where a `void` one would drop the Effect silently
 * (ADR-0027, decision 8).
 *
 * A Frame handed to a sink is the run's until the next tick: a step may rewrite it in place
 * (`Machine.springValues`' does), so a sink that keeps a Frame, its `value` or its `velocity`,
 * copies it (ADR-0030, decision 11).
 */
export type Sink<F> = (frame: F) => undefined

/** The Frame loop: `run(machine, sink)`, which `Machine.run(sink)` reaches. */
export class FrameLoop extends Context.Service<FrameLoop, internal.Shape>()("@wardic/FrameLoop", {
  make: internal.make,
}) {}

/** The Frame loop over the Environment's `Clock`. Every Environment merges it in (`DomLive`, `testLayer`). */
export const layer = Layer.effect(FrameLoop)(FrameLoop.make())
