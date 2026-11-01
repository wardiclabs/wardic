/**
 * The `Renderer` module: the output sink an Environment writes values to, behind the
 * `Renderer.Renderer` service (ADR-0002), its `Patch`, and `applyTo`, which drains a Frame
 * stream into a target through it (ADR-0028, decisions 11 and 12).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Stream from "effect/Stream"
import type * as Frame from "./Frame.ts"

/**
 * Output of `Renderer.project` — the environment-specific representation of a
 * frame's values, ready to be written by `Renderer.commit`. Structurally an
 * opaque `Record<string, unknown>` so each environment (DOM, canvas, native)
 * is free to encode grouped fields (e.g. an aggregated `transform` string)
 * without leaking that shape into engine code.
 */
export type Patch = Record<string, unknown>

/**
 * Output sink. Writes computed animation values onto whatever the environment
 * renders to — a DOM element's style, a canvas context, a native view, etc.
 *
 * Split into two halves (see ADR-0002):
 *   - `project` — pure, synchronous: translates engine values into the
 *     environment's representation (`Patch`). Side-effect-free; the Starting style
 *     reuses it, so DOM grouping/unit logic isn't duplicated.
 *   - `commit` — imperative: writes a `Patch` to `target`, now. The flush gate commits
 *     every binding element's patch once per Refresh frame (ADR-0006, ADR-0034), and
 *     `applyTo` commits a Frame stream outside a binding.
 *
 * Both are plain functions, not Effects: they run once per element per frame, where an
 * Effect round trip per call costs a fiber each (ADR-0034, docs/agents/effect-first.md).
 *
 * `target` is environment-defined and opaque to the engine; the DOM renderer
 * treats it as an `HTMLElement`, a canvas renderer as a draw context, and so on.
 */
export class Renderer extends Context.Service<Renderer, {
  /** Pure: translate engine values into the environment's patch shape. */
  readonly project: (values: Record<string, unknown>) => Patch
  /** Imperative: write a projected patch onto `target`, synchronously. */
  readonly commit: (target: unknown, patch: Patch) => void
}>()("@wardic/Renderer") {}

/**
 * Imperative-path entry point (see ADR 0002).
 *
 * Drains a frame stream into `target` by routing every emission through the
 * `Renderer`'s two halves: `project` translates the engine values into the
 * environment's patch shape (e.g. grouping `x`/`y`/`scale` into one DOM
 * `transform` string), and `commit` writes that patch onto the target.
 *
 * A binding's elements go through its flush gate instead (ADR-0006, ADR-0034): this is
 * the combinator for a Frame stream rendered outside a binding (canvas, native, tests),
 * where the engine pushes values into a sink each tick, one commit per Frame.
 *
 * The typed surface accepts a `Frame<Record<string, unknown>>`, which is the
 * shape `springValues` and `animateValues` already emit (their `Values` map is
 * assignable to `Record<string, unknown>`); single-scalar primitives are wrapped
 * by the binding layer before reaching `applyTo`. `dual`, the stream first:
 * `stream.pipe(Renderer.applyTo(target))` (ADR-0028, decision 12).
 *
 * Observability: a single `wardic.applyTo` span wraps the stream and one
 * annotated `Effect.logDebug("wardic.applyTo: subscribe")` fires when the
 * stream starts. Per-frame work is deliberately un-logged — this is the
 * hot path.
 */
export const applyTo: {
  <T>(target: T): <E, R>(
    stream: Stream.Stream<Frame.Frame<Record<string, unknown>>, E, R>,
  ) => Effect.Effect<void, E, R | Renderer>
  <T, E, R>(stream: Stream.Stream<Frame.Frame<Record<string, unknown>>, E, R>, target: T): Effect.Effect<void, E, R | Renderer>
} = dual(
  2,
  // Not `Effect.fn`, which always captures a call-site stack (ADR-0040, decision 2).
  Effect.fnUntraced(
    function* <T, E, R>(stream: Stream.Stream<Frame.Frame<Record<string, unknown>>, E, R>, target: T): Effect.fn.Return<void, E, R | Renderer> {
      yield* Effect.annotateCurrentSpan({ target: typeof target })
      const renderer = yield* Renderer
      yield* Effect.logDebug("wardic.applyTo: subscribe").pipe(Effect.annotateLogs({ target: typeof target }))
      yield* stream.pipe(Stream.runForEach((frame) => Effect.sync(() => renderer.commit(target, renderer.project(frame.value)))))
    },
    Effect.withSpan("wardic.applyTo", undefined, { captureStackTrace: false }),
  ),
)
