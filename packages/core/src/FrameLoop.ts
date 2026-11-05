/**
 * The Frame loop: the one loop per Environment that steps every running animation once a tick, in one
 * pass, so many animations cost one loop and not a fiber each. A binding runs its animations on it with
 * `Machine.run`, each Frame handed to its sink. `CheckFrames` turns on a check for development, which
 * fails a run whose step gives a NaN or an Infinity, with `NonFiniteFrame`.
 *
 * @example
 * import * as FrameLoop from "@wardic/core/FrameLoop"
 *
 * // In development, beside the Environment you hand your provider:
 * const checked = Layer.mergeAll(environment, Layer.succeed(FrameLoop.CheckFrames, true))
 */
// ADR-0027. A Primitive's `Stream` (Tier 2, `Machine.toStream`) runs the same machine on its own. A
// caller that replaces runs together (a Retarget) gives them a `Supersede` token and ends them with it,
// without interrupting their fibers (#200). Its shape and `make` are internal (ADR-0028, decision 11).
// `CheckFrames`: ADR-0030, decision 7. Tier 2 (ADR-0008): Effect-typed, for binding and Environment
// authors.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as internal from "./internal/frameLoop.ts"

export { CheckFrames, NonFiniteFrame } from "./internal/frameLoop.ts"

/**
 * Where a run's Frames go: a plain call, never an Effect. It returns `undefined`, so a sink that returns
 * an Effect doesn't compile, where a `void` one would drop the Effect silently. A Frame handed to a sink
 * is the run's until the next tick, which may rewrite it in place: a sink that keeps a Frame, its
 * `value` or its `velocity`, copies it.
 */
// ADR-0027, decision 8; ADR-0030, decision 11 (`Machine.springValues`' Frame).
export type Sink<F> = (frame: F) => undefined

/**
 * The Frame loop: `run` runs a machine on it, as `Machine.run` does, and `runLast` one stepped after
 * every other in each tick, for one that reads what the others wrote.
 */
// `runLast` is the projection's coordinator's (ADR-0027, *Amendment (#137)*).
export class FrameLoop extends Context.Service<FrameLoop, internal.Shape>()("@wardic/FrameLoop", {
  make: internal.make,
}) {}

/** The Frame loop over the Environment's `Clock`. Every Environment merges it in. */
// `DomLive`, `testLayer`.
export const layer = Layer.effect(FrameLoop)(FrameLoop.make())
