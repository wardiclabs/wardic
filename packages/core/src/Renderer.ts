/**
 * The Renderer: how an Environment writes animated values to what it draws, an element, a canvas
 * context, a native view. It has two halves: `project`, pure, turns a Frame's values into the
 * Environment's own `Patch`, grouping keys as it likes; and `commit` writes a patch onto a target, now.
 * A binding writes its elements through its flush; `applyTo` writes a Frame stream outside one.
 *
 * @example
 * import * as Renderer from "@wardic/core/Renderer"
 *
 * yield* Machine.toStream(Machine.springValues({ x: 100 })).pipe(Renderer.applyTo(target))
 */
// ADR-0002; `applyTo` (ADR-0028, decisions 11 and 12).
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type * as Frame from "./Frame.ts"
import { dual } from "./internal/dual.ts"
import { traced } from "./internal/tracing.ts"

/**
 * What `project` gives: a Frame's values in the Environment's own form, ready for `commit`. Opaque to
 * core, so an Environment can group keys as it draws them: `@wardic/dom` writes `x`, `y` and `scale` as
 * one transform.
 */
export type Patch = Record<string, unknown>

/**
 * An Environment's renderer. Both halves are plain functions, not Effects: they run once per element per
 * frame. `target` is the Environment's own, opaque to core.
 */
// ADR-0002. `project` is pure, so the Starting style reuses it and no grouping or unit logic is
// duplicated. The flush gate commits every binding element's patch once per Refresh frame (ADR-0006,
// ADR-0034); an Effect round trip per call would cost a fiber each (ADR-0034,
// docs/agents/effect-first.md). `@wardic/dom`'s renderer takes an element as its target.
export class Renderer extends Context.Service<Renderer, {
  /** Turns a Frame's values into the Environment's patch: pure, so a binding can project values it doesn't write yet. */
  readonly project: (values: Record<string, unknown>) => Patch
  /** Writes a patch onto `target`, now. */
  readonly commit: (target: unknown, patch: Patch) => void
}>()("@wardic/core/Renderer") {}

/**
 * Writes each Frame of `stream` onto `target`, projecting its values and committing them, one commit per
 * Frame: for a Frame stream outside a binding, a canvas's, a native view's, a test's. A binding's
 * elements go through its flush instead. `stream` gives Frames of a record of values, as
 * `Machine.springValues` and `Machine.animateValues` do.
 *
 * @example
 * yield* frames.pipe(Renderer.applyTo(target))
 */
// ADR-0002; ADR-0006, ADR-0034 (the flush gate). Single-scalar primitives are wrapped by the binding
// before reaching it. `dual`, the stream first (ADR-0028, decision 12). Observability: one
// `wardic.applyTo` span around the stream and one `wardic.applyTo: subscribe` debug log; per-frame work
// is un-logged, the hot path.
export const applyTo: {
  <T>(target: T): <E, R>(
    stream: Stream.Stream<Frame.Frame<Record<string, unknown>>, E, R>,
  ) => Effect.Effect<void, E, R | Renderer>
  <T, E, R>(stream: Stream.Stream<Frame.Frame<Record<string, unknown>>, E, R>, target: T): Effect.Effect<void, E, R | Renderer>
} = dual(
  // The target is any value: told apart by the stream (#460).
  Stream.isStream,
  // Not `Effect.fn`, which always captures a call-site stack (ADR-0040, decision 2).
  Effect.fnUntraced(
    function* <T, E, R>(stream: Stream.Stream<Frame.Frame<Record<string, unknown>>, E, R>, target: T): Effect.fn.Return<void, E, R | Renderer> {
      yield* Effect.annotateCurrentSpan({ target: typeof target })
      const renderer = yield* Renderer
      yield* Effect.logDebug("wardic.applyTo: subscribe").pipe(Effect.annotateLogs({ target: typeof target }))
      yield* stream.pipe(Stream.runForEach((frame) => Effect.sync(() => renderer.commit(target, renderer.project(frame.value)))))
    },
    (self) => traced(self, "wardic.applyTo"),
  ),
)
