import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { Atom, type AtomRegistry } from "effect/unstable/reactivity"
import type { Frame } from "../primitives/frame.ts"
import { Probe } from "../services/Probe.ts"

/**
 * Honor the user's `prefers-reduced-motion` preference for an animation stream.
 *
 * Reads `Probe.prefersReducedMotion` **once** at subscribe time. If the
 * preference is `true`, the upstream is run to completion to grab its terminal
 * frame, and a single settled `Frame<V>` is emitted — the user sees the target
 * value instantly with no transition. If the preference is `false`, the input
 * stream is returned unchanged (no wrapping cost, no re-reads on later frames).
 *
 * Observability: a single `wardic.respectReducedMotion` span wraps the stream
 * and an annotated debug log fires once on subscribe carrying the resolved
 * preference. Per-frame work is deliberately un-logged.
 *
 * The resulting stream's requirement set widens with `Probe` and `AtomRegistry`
 * — the latter is needed to read the atom's current value. The Probe layer
 * supplies the atom; the AtomRegistry provides the registry to read it.
 */
export const respectReducedMotion = <V, E, R>(
  stream: Stream.Stream<Frame<V>, E, R>,
): Stream.Stream<Frame<V>, E, R | Probe | AtomRegistry.AtomRegistry> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const probe = yield* Probe
      const prefersReducedMotion = yield* Atom.get(probe.prefersReducedMotion)
      yield* Effect.logDebug("wardic.respectReducedMotion: subscribe").pipe(
        Effect.annotateLogs({ prefersReducedMotion }),
      )
      if (!prefersReducedMotion) return stream
      return Stream.unwrap(
        Stream.runLast(stream).pipe(
          Effect.map((last) => {
            const terminal = Option.getOrUndefined(last)
            if (terminal === undefined) return Stream.empty as Stream.Stream<Frame<V>, E, never>
            return Stream.succeed<Frame<V>>({ value: terminal.value, done: true })
          }),
        ),
      )
    }),
  ).pipe(Stream.withSpan("wardic.respectReducedMotion"))
