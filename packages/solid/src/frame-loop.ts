/**
 * The binding's runs on the Environment's **Frame loop** (ADR-0027, #74). The spine's legs,
 * presence's exit and drag's release each hand their Primitive's machine to `FrameLoop.run`, so
 * every animation the binding starts is stepped in the loop's one pass per tick, on its one
 * `Clock.ticks` subscription, where each used to be a fiber running its own `Stream`.
 */
import { type Frame, FrameLoop, type Machine, type Sink } from "@wardic/core"
import * as Effect from "effect/Effect"

/**
 * Build `machine` (`springBlend`'s and `animateValues`' resolve their blenders here) and run it
 * on the Frame loop, from the loop's next tick, handing each Frame to `sink`: a plain call,
 * typed `(frame) => undefined`, so a sink that returns an Effect doesn't compile. Succeeds with
 * the settled Frame. Dies if the step or the sink throws, or with the loop's own failure.
 * Interrupting it removes the run at once.
 */
export const runOnLoop = <F extends Frame<unknown>, R>(
  machine: Effect.Effect<Machine<F>, never, R>,
  sink: Sink<F>,
): Effect.Effect<F, never, R | FrameLoop> => Effect.flatMap(machine, (built) => FrameLoop.use((loop) => loop.run(built, sink)))
