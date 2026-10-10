import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import { type FrameLoopShape, makeFrameLoop } from "./frame-loop.ts"

/**
 * The **Frame loop** (ADR-0027): the one loop per Environment that steps every running Primitive
 * once per tick, in one pass. A binding runs its Primitives on it with `Machine.run(sink)` rather
 * than one fiber per animation; a Primitive's `Stream` (Tier 2, `Machine.toStream`) runs the same
 * machine on its own.
 *
 * Tier 2 (ADR-0008): Effect-typed, for binding and Environment authors.
 */
export class FrameLoop extends Context.Service<FrameLoop, FrameLoopShape>()("@wardic/FrameLoop", {
  make: makeFrameLoop,
}) {}

/** The Frame loop over the Environment's `Clock`. Every Environment merges it in (`DomLive`, `testLayer`). */
export const FrameLoopLive = Layer.effect(FrameLoop)(FrameLoop.make())
