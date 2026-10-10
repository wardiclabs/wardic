/**
 * The `ReducedMotion` module: the user's `prefers-reduced-motion`, honoured for an animation
 * stream.
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { Atom, type AtomRegistry } from "effect/reactivity"
import type * as Frame from "./Frame.ts"
import * as Probe from "./Probe.ts"

/**
 * Honor the user's `prefers-reduced-motion` preference for an animation stream.
 *
 * Reads `Probe.prefersReducedMotion` **once** at subscribe time. If the
 * preference is `true`, the upstream is run to completion to grab its terminal
 * frame, and a single settled `Frame.Frame<V>` is emitted — the user sees the target
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
export const respect = <V, E, R>(
  stream: Stream.Stream<Frame.Frame<V>, E, R>,
): Stream.Stream<Frame.Frame<V>, E, R | Probe.Probe | AtomRegistry.AtomRegistry> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const probe = yield* Probe.Probe
      const prefersReducedMotion = yield* Atom.get(probe.prefersReducedMotion)
      yield* Effect.logDebug("wardic.respectReducedMotion: subscribe").pipe(
        Effect.annotateLogs({ prefersReducedMotion }),
      )
      return Bool.match(prefersReducedMotion, {
        onFalse: () => stream,
        onTrue: () =>
          Stream.unwrap(
            Stream.runLast(stream).pipe(
              Effect.map(
                Option.match({
                  onNone: () => Stream.empty as Stream.Stream<Frame.Frame<V>, E, never>,
                  onSome: (terminal) => Stream.succeed<Frame.Frame<V>>({ value: terminal.value, done: true }),
                }),
              ),
            ),
          ),
      })
    }),
  ).pipe(Stream.withSpan("wardic.respectReducedMotion"))
