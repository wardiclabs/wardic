import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { Frame } from "../primitives/frame.ts"
import { Renderer } from "../services/Renderer.ts"

/**
 * Imperative-path entry point (see ADR 0002).
 *
 * Drains a frame stream into `target` by routing every emission through the
 * `Renderer`'s two halves: `project` translates the engine values into the
 * environment's patch shape (e.g. grouping `x`/`y`/`scale` into one DOM
 * `transform` string), and `commit` writes that patch onto the target.
 *
 * The Solid declarative surface renders reactively and never calls this — it's
 * the consumer-facing combinator behind `createAnimate` / `use:ward`, canvas,
 * and native bindings, where the engine must push values into a sink each tick.
 *
 * The typed surface accepts a `Frame<Record<string, unknown>>`, which is the
 * shape `springValues` and `animateValues` already emit (their `Values` map is
 * assignable to `Record<string, unknown>`); single-scalar primitives are wrapped
 * by the binding layer before reaching `applyTo`.
 *
 * Observability: a single `wardic.applyTo` span wraps the stream and one
 * annotated `Effect.logDebug("wardic.applyTo: subscribe")` fires when the
 * stream starts. Per-frame work is deliberately un-logged — this is the
 * hot path.
 */
export const applyTo = <T, E, R>(
  target: T,
  stream: Stream.Stream<Frame<Record<string, unknown>>, E, R>,
): Effect.Effect<void, E, R | Renderer> =>
  Effect.gen(function* () {
    const renderer = yield* Renderer
    yield* Effect.logDebug("wardic.applyTo: subscribe").pipe(
      Effect.annotateLogs({ target: typeof target }),
    )
    yield* stream.pipe(
      Stream.runForEach((frame) => renderer.commit(target, renderer.project(frame.value))),
    )
  }).pipe(Effect.withSpan("wardic.applyTo", { attributes: { target: typeof target } }))
