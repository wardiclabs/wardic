/**
 * The `FrameLoop` module (ADR-0027): the one loop per Environment that steps every running
 * Primitive once per tick, in one pass. A binding runs its Primitives on it with
 * `Machine.run(sink)` rather than one fiber per animation; a Primitive's `Stream` (Tier 2,
 * `Machine.toStream`) runs the same machine on its own. Its shape and `make` are internal
 * (ADR-0028, decision 11).
 *
 * Tier 2 (ADR-0008): Effect-typed, for binding and Environment authors.
 */
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as internal from "./internal/frameLoop.ts"

/**
 * Where a run's Frames go: a plain call, never an Effect. Its return type is `undefined`, so a
 * sink that returns an Effect doesn't compile, where a `void` one would drop the Effect silently
 * (ADR-0027, decision 8).
 */
export type Sink<F> = (frame: F) => undefined

/** The Frame loop: `run(machine, sink)`, which `Machine.run(sink)` reaches. */
export class FrameLoop extends Context.Service<FrameLoop, internal.Shape>()("@wardic/FrameLoop", {
  make: internal.make,
}) {}

/** The Frame loop over the Environment's `Clock`. Every Environment merges it in (`DomLive`, `testLayer`). */
export const layer = Layer.effect(FrameLoop)(FrameLoop.make())
