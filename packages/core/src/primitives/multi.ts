import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import type { AnimateOptions, SpringOptions, Values } from "../options.ts"
import type { Clock } from "../services/Clock.ts"
import { InterpolatorRegistry } from "../services/InterpolatorRegistry.ts"
import { type Frame, MAX_DT, type MultiPhysicsFrame } from "./frame.ts"
import { type Machine, mapFrames, toStream } from "./machine.ts"
import { animate, animateMachine } from "./scalar.ts"
import { initSpring, resolveSpring, type SpringState, stepSpring } from "./stepper.ts"

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

/** One key with the values it blends from and to. */
type KeyedPair = readonly [key: string, from: number | string, to: number | string]

/** A `display` or `visibility` key. */
const isVisibilityKey: Predicate.Predicate<string> = (key) => VISIBILITY_KEYS.has(key)

/** A pair that hides: a `display` or `visibility` key, from a visible value to `none` or `hidden`. */
const hides: Predicate.Predicate<KeyedPair> = Predicate.Tuple([isVisibilityKey, Predicate.not(isInvisible), isInvisible])

/** A hiding pair's blender: it shows `from` until the leg's last frame, then `to`. Per frame: a statement `if`. */
const holdUntilDone =
  (from: number | string, to: number | string): Blender =>
  (_t, done) => {
    if (done) return to
    return from
  }

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
        return Option.liftPredicate([key, a, b] as const, hides).pipe(
          Option.map(([, shown, hidden]) => holdUntilDone(shown, hidden)),
          Option.match({
            onNone: () => Effect.map(registry.resolve(a, b), (blend): Blender => (t) => blend(t)),
            onSome: Effect.succeed,
          }),
        )
      }),
    )
  })

/**
 * Every key's blend at one progress frame. On the per-frame path (ADR-0025): a loop over the
 * `[key, blender]` pairs built with the stream, not `Rec.map`, which spreads the record and then
 * reassigns every key (#63 measured `Rec.map` 1.6× this loop in Chromium, 2.3× in JSC).
 */
const blendAt = (
  blenders: ReadonlyArray<readonly [key: string, blend: Blender]>,
  t: number,
  done: boolean,
): Frame<Values> => {
  const value: Record<string, number | string> = {}
  for (const pair of blenders) value[pair[0]] = pair[1](t, done)
  return { value, done }
}

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
      const blenders = Rec.toEntries(yield* blendersFor(from, to))
      return animate(0, 1, options).pipe(Stream.map((progress) => blendAt(blenders, progress.value, progress.done)))
    }),
  ).pipe(Stream.withSpan("wardic.animateValues", { attributes: { keys: Object.keys(to).length } }))

/**
 * `animateValues`' machine (ADR-0027): `animate`'s from 0 to 1, each Frame blended through the
 * registry's blenders, resolved here once. Building it needs the `InterpolatorRegistry`; its
 * steps don't.
 */
export const animateValuesMachine = (
  from: Values,
  to: Values,
  options: AnimateOptions = DEFAULT_DURATION,
): Effect.Effect<Machine<Frame<Values>>, never, InterpolatorRegistry> =>
  Effect.map(blendersFor(from, to), (resolved) => {
    const blenders = Rec.toEntries(resolved)
    return mapFrames(
      animateMachine(0, 1, options),
      (progress) => blendAt(blenders, progress.value, progress.done),
      { name: "wardic.animateValues", attributes: { keys: Object.keys(to).length } },
    )
  })

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
      const blenders = Rec.toEntries(yield* blendersFor(from, to))
      return springValues({ progress: 100 }, options, { progress: 0 }, { progress: 0 }).pipe(
        Stream.map((frame) => blendAt(blenders, UndefinedOr.getOrThrow(frame.value.progress) / 100, frame.done)),
      )
    }),
  ).pipe(Stream.withSpan("wardic.springBlend", { attributes: { keys: Object.keys(to).length } }))

/**
 * `springBlend`'s machine (ADR-0027): `springValues`' on a 0→100 progress, from rest, each Frame
 * blended through the registry's blenders at progress / 100, resolved here once.
 */
export const springBlendMachine = (
  from: Values,
  to: Values,
  options: SpringOptions = {},
): Effect.Effect<Machine<Frame<Values>>, never, InterpolatorRegistry> =>
  Effect.map(blendersFor(from, to), (resolved) => {
    const blenders = Rec.toEntries(resolved)
    return mapFrames(
      springValuesMachine({ progress: 100 }, options, { progress: 0 }, { progress: 0 }),
      (frame) => blendAt(blenders, UndefinedOr.getOrThrow(frame.value.progress) / 100, frame.done),
      { name: "wardic.springBlend", attributes: { keys: Object.keys(to).length } },
    )
  })

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
  const machine = springValuesMachine(target, options, from, velocity)
  return Stream.unwrap(
    Effect.logDebug("wardic.springValues: subscribe").pipe(
      Effect.annotateLogs({ keys: Rec.keys(target) }),
      Effect.as(toStream(machine)),
    ),
  ).pipe(Stream.withSpan(machine.span.name, { attributes: machine.span.attributes }))
}

/**
 * `springValues`' machine (ADR-0027): one spring per key with the shared `options`, from
 * `from` / `velocity` (default 0 / `options.from` / `options.velocity`), settling once every key
 * is at rest. Its step clamps `dt` at `MAX_DT` once per tick, as every leaf's does (#78).
 */
export const springValuesMachine = (
  target: Record<string, number>,
  options: SpringOptions = {},
  from: Record<string, number> = {},
  velocity: Record<string, number> = {},
): Machine<MultiPhysicsFrame> => {
  const keys = Rec.keys(target)
  /** A key's start: its own value, else the options', else 0. */
  const startOf = (values: Record<string, number>, key: string, fallback: number | undefined): number =>
    Option.fromNullishOr(values[key]).pipe(
      Option.orElse(() => Option.fromNullishOr(fallback)),
      Option.getOrElse(() => 0),
    )
  const spring = resolveSpring(options)
  return {
    settles: true,
    span: { name: "wardic.springValues", attributes: { keys: keys.length } },
    start: () => {
      let states: Rec.ReadonlyRecord<string, SpringState> = Rec.map(target, (_, key) =>
        initSpring({
          ...options,
          from: startOf(from, key, options.from),
          velocity: startOf(velocity, key, options.velocity),
        }),
      )
      // Per frame (ADR-0025): `dt` clamped at the engine boundary once, then a loop over the
      // keys, every key's state and target present by construction. Records, as before: #63's
      // bench measured an array of states, filled by `push` and destructured, at +18% bytes per
      // frame.
      return (dt) => {
        const clampedDt = Math.min(dt, MAX_DT)
        const nextStates: Record<string, SpringState> = {}
        const values: Record<string, number> = {}
        const velocities: Record<string, number> = {}
        let allDone = true
        for (const key of keys) {
          const result = stepSpring(
            UndefinedOr.getOrThrow(states[key]),
            clampedDt,
            UndefinedOr.getOrThrow(target[key]),
            spring,
          )
          nextStates[key] = result.state
          values[key] = result.value
          velocities[key] = result.velocity
          if (!result.done) allDone = false
        }
        states = nextStates
        return { value: values, velocity: velocities, done: allDone }
      }
    },
  }
}
