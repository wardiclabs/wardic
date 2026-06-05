import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { AnimateOptions, SpringOptions, Values } from "../options.ts"
import { Clock } from "../services/Clock.ts"
import { InterpolatorRegistry } from "../services/InterpolatorRegistry.ts"
import type { Frame, MultiPhysicsFrame } from "./frame.ts"
import { animate } from "./scalar.ts"
import { initSpring, type SpringState, springStep } from "./stepper.ts"

const DEFAULT_DURATION: AnimateOptions = { duration: 0.3 }

/**
 * Animate a bag of values from `from` to `to`, interpolating each key through
 * the `InterpolatorRegistry` (so numbers, colors and unit-strings all work). A
 * single `animate(0, 1, options)` progress stream drives every key, so all
 * modifiers (`reverse`, `repeat`, `yoyo`, including `repeat: Infinity`) apply
 * uniformly to the multi form. `done` is threaded straight from the underlying
 * progress frame.
 *
 * Hot-path shape: the registry is consulted **once** at stream construction —
 * each key resolves to a pure `(t: number) => unknown` that's stored in a
 * lookup map. Per-tick work is `keys.length` direct function calls, no Effect
 * round-trips and no service access in the inner loop.
 */
export const animateValues = (
  from: Values,
  to: Values,
  options: AnimateOptions = DEFAULT_DURATION,
): Stream.Stream<Frame<Values>, never, Clock | InterpolatorRegistry> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const keys = Object.keys(to)
      yield* Effect.logDebug("wardic.animateValues: subscribe").pipe(
        Effect.annotateLogs({ keys, duration: options.duration }),
      )
      const registry = yield* InterpolatorRegistry
      const blenders: Record<string, (t: number) => unknown> = {}
      for (const key of keys) {
        const a = from[key] ?? to[key]!
        blenders[key] = yield* registry.resolve(a, to[key]!)
      }
      return animate(0, 1, options).pipe(
        Stream.map((progress) => {
          const out: Record<string, number | string> = {}
          for (const key of keys) {
            out[key] = blenders[key]!(progress.value) as number | string
          }
          return { value: out as Values, done: progress.done } satisfies Frame<Values>
        }),
      )
    }),
  ).pipe(Stream.withSpan("wardic.animateValues", { attributes: { keys: Object.keys(to).length } }))

/**
 * Spring a bag of numeric values toward `target`. Each key runs its own spring
 * with the shared `options`; the stream emits a `MultiPhysicsFrame` per tick
 * and settles (via `Stream.takeUntil`) once every key is at rest. `from`
 * supplies per-key start positions (default 0 / `options.from`) and `velocity`
 * supplies per-key initial velocities (default 0 / `options.velocity`).
 *
 * Each emitted frame carries a per-key `velocity` map alongside `value`,
 * collected straight from each spring's `springStep` result. A settled key
 * reports velocity 0. Seeding both `from` and `velocity` from a prior frame
 * makes a velocity-preserving retarget possible — momentum stays continuous
 * across the handoff instead of resetting to 0.
 *
 * Hot-path shape stays registry-free: per tick is `keys.length` direct pure
 * `springStep` calls, no Effect round-trips and no service access in the loop.
 */
export const springValues = (
  target: Record<string, number>,
  options: SpringOptions = {},
  from: Record<string, number> = {},
  velocity: Record<string, number> = {},
): Stream.Stream<MultiPhysicsFrame, never, Clock> => {
  const keys = Object.keys(target)
  return Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.springValues: subscribe").pipe(Effect.annotateLogs({ keys }))
      const clock = yield* Clock
      return clock.ticks.pipe(
        Stream.mapAccum(
          (): Record<string, SpringState> => {
            const initial: Record<string, SpringState> = {}
            for (const key of keys) {
              initial[key] = initSpring({
                ...options,
                from: from[key] ?? options.from ?? 0,
                velocity: velocity[key] ?? options.velocity ?? 0,
              })
            }
            return initial
          },
          (states, dt) => {
            const nextStates: Record<string, SpringState> = {}
            const values: Record<string, number> = {}
            const velocities: Record<string, number> = {}
            let allDone = true
            for (const key of keys) {
              const result = springStep(states[key]!, dt, target[key]!, options)
              nextStates[key] = result.state
              values[key] = result.value
              velocities[key] = result.velocity
              if (!result.done) allDone = false
            }
            return [
              nextStates,
              [{ value: values, velocity: velocities, done: allDone }],
            ] as const
          },
        ),
        Stream.takeUntil((frame: MultiPhysicsFrame) => frame.done),
      )
    }),
  ).pipe(Stream.withSpan("wardic.springValues", { attributes: { keys: keys.length } }))
}
