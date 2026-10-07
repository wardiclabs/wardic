import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Stream from "effect/Stream"
import type { AnimateOptions, SpringOptions, Values } from "../options.ts"
import { Clock } from "../services/Clock.ts"
import { InterpolatorRegistry } from "../services/InterpolatorRegistry.ts"
import type { Frame, MultiPhysicsFrame } from "./frame.ts"
import { animate } from "./scalar.ts"
import { initSpring, type SpringState, springStep } from "./stepper.ts"

const DEFAULT_DURATION: AnimateOptions = { duration: 0.3 }

/** One key's blend at a progress `t`, given whether that progress frame is the leg's last. */
type Blender = (t: number, done: boolean) => number | string

/** The keys whose turn to `none` or `hidden` waits for the leg's last frame (ADR-0024, decision 4). */
const VISIBILITY_KEYS: ReadonlySet<string> = new Set(["display", "visibility"])
const INVISIBLE: ReadonlySet<string> = new Set(["none", "hidden"])

/** A `none` or `hidden` value: what a `display` or `visibility` key turns to when it hides. */
const isInvisible: Predicate.Refinement<unknown, string> = Predicate.compose(
  Predicate.isString,
  (value: string) => INVISIBLE.has(value.trim()),
)

/** A `display` or `visibility` pair that hides: from a visible value to `none` or `hidden`. */
const hides = (key: string, from: number | string, to: number | string): boolean =>
  VISIBILITY_KEYS.has(key) && isInvisible(to) && Predicate.not(isInvisible)(from)

/**
 * Each key's blender from `from[key]` (its target when absent) to `to[key]`, resolved through
 * the `InterpolatorRegistry` once. A pair the registry can't blend is a Discrete pair and
 * switches at the first frame past 0 (ADR-0024, decision 3). `display` and `visibility`, by
 * name, turning from any other value to `none` or `hidden`, switch on the leg's last frame
 * instead (decision 4): Motion's `mixVisibility` (motion-dom utils/mix/visibility.ts:1-14 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8), keyed on the frame's `done` rather than on progress
 * 1, so a spring's progress crossing 1 and back can't flicker it.
 */
const blendersFor = (
  from: Values,
  to: Values,
): Effect.Effect<Rec.ReadonlyRecord<string, Blender>, never, InterpolatorRegistry> =>
  Effect.gen(function* () {
    const registry = yield* InterpolatorRegistry
    return yield* Effect.all(
      Rec.map(to, (b, key): Effect.Effect<Blender> => {
        const a = Option.getOrElse(Rec.get(from, key), () => b)
        return hides(key, a, b)
          ? Effect.succeed((_t, done) => (done ? b : a))
          : Effect.map(registry.resolve(a, b), (blend): Blender => (t) => blend(t))
      }),
    )
  })

/** Every key's blend at one progress frame. */
const blendAt = (blenders: Rec.ReadonlyRecord<string, Blender>, t: number, done: boolean): Frame<Values> => ({
  value: Rec.map(blenders, (blend) => blend(t, done)),
  done,
})

/**
 * Animate a bag of values from `from` to `to`, interpolating each key through
 * the `InterpolatorRegistry` (so numbers, colors and unit-strings all work). A
 * single `animate(0, 1, options)` progress stream drives every key, so all
 * modifiers (`reverse`, `repeat`, `yoyo`, including `repeat: Infinity`) apply
 * uniformly to the multi form. `done` is threaded straight from the underlying
 * progress frame. A Discrete pair switches at the first frame; `display` and
 * `visibility` turn `none` / `hidden` on the last (ADR-0024).
 *
 * Hot-path shape: the registry is consulted **once** at stream construction —
 * each key resolves to a pure blender that's stored in a lookup map. Per-tick
 * work is `keys.length` direct function calls, no Effect round-trips and no
 * service access in the inner loop.
 */
export const animateValues = (
  from: Values,
  to: Values,
  options: AnimateOptions = DEFAULT_DURATION,
): Stream.Stream<Frame<Values>, never, Clock | InterpolatorRegistry> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.animateValues: subscribe").pipe(
        Effect.annotateLogs({ keys: Object.keys(to), duration: options.duration }),
      )
      const blenders = yield* blendersFor(from, to)
      return animate(0, 1, options).pipe(Stream.map((progress) => blendAt(blenders, progress.value, progress.done)))
    }),
  ).pipe(Stream.withSpan("wardic.animateValues", { attributes: { keys: Object.keys(to).length } }))

/**
 * Blend a bag of values from `from` to `to` by one spring's progress (ADR-0024, decision 5):
 * a spring with `options` (stiffness, damping, mass, rest thresholds, `delay`) runs from rest on
 * a 0→100 progress, and each key is blended through the `InterpolatorRegistry` at progress / 100.
 * It's how a spring's string keys follow the spring, as Motion runs a spring on a string
 * (motion-dom animation/JSAnimation.ts:132-148 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8).
 *
 * - The progress spans 0–100 as a numeric key travelling 100 would, so `restDelta` and
 *   `restVelocity` mean the same for both, and a colour beside an `x` going 0 → 100 lands with it.
 * - It always starts from rest: `options.from` and `options.velocity` don't move it. A velocity
 *   in a key's units has no meaning on the progress.
 * - Past 1, a colour holds at its target (culori clamps its progress) and a unit string or
 *   number overshoots. A Discrete pair switches at the first frame past the delay; `display`
 *   and `visibility` turn `none` / `hidden` on the settle frame.
 */
export const springBlend = (
  from: Values,
  to: Values,
  options: SpringOptions = {},
): Stream.Stream<Frame<Values>, never, Clock | InterpolatorRegistry> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug("wardic.springBlend: subscribe").pipe(Effect.annotateLogs({ keys: Object.keys(to) }))
      const blenders = yield* blendersFor(from, to)
      return springValues({ progress: 100 }, options, { progress: 0 }, { progress: 0 }).pipe(
        Stream.map((frame) => blendAt(blenders, frame.value.progress! / 100, frame.done)),
      )
    }),
  ).pipe(Stream.withSpan("wardic.springBlend", { attributes: { keys: Object.keys(to).length } }))

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
