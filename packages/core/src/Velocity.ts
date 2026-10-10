/**
 * The `Velocity` module: a velocity between two samples (`between`), a value stream's on the
 * Clock (`of`), and a pointer's over a trailing window (`trailing`), a **Reorder group**'s
 * direction.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as Clock from "./Clock.ts"
import type * as Point from "./Point.ts"

/** Instantaneous velocity from two samples and the delta time between them. */
export const between = (previous: number, current: number, dt: number): number => {
  if (dt === 0) return 0
  return (current - previous) / dt
}

/** The velocity since `previous`, or 0 at the first tick, which has none. Per frame: an early return. */
const velocitySince = (previous: number | undefined, current: number, dt: number): number => {
  if (Predicate.isUndefined(previous)) return 0
  return between(previous, current, dt)
}

/**
 * Transform a value stream into a velocity stream sourced from the engine
 * `Clock`. Each emitted value is paired with the `dt` of the frame it was
 * produced on, so velocities reflect the real elapsed time (variable frame
 * times supported). The first frame reports `0` (no previous sample yet).
 *
 * For ad-hoc, non-Clock contexts the standalone {@link between} helper remains
 * available.
 */
export const of = <E, R>(
  values: Stream.Stream<number, E, R>,
): Stream.Stream<number, E, R | Clock.Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      return Stream.zipWith(values, clock.ticks, (current, dt) => [current, dt] as const).pipe(
        Stream.mapAccum(
          (): { previous: number | undefined } => ({ previous: undefined }),
          (state, [current, dt]) => {
            const v = velocitySince(state.previous, current, dt)
            return [{ previous: current }, [v]] as const
          },
        ),
      )
    }),
  )

/**
 * A pointer position at a time (ms, the event's `timeStamp`).
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export interface TimedPoint {
  readonly x: number
  readonly y: number
  readonly timeStamp: number
}

/**
 * The velocity (units/s) over the trailing `windowMs` of `history`, oldest first: from
 * the newest point more than `windowMs` older than the last one (or the oldest point)
 * to the last. When that is the first point, there are more than two, and it's more
 * than twice the window old, the second point is used instead, so a hold before a
 * flick doesn't dilute it. Motion's `getVelocity` (gestures/pan/PanSession.ts:383-440
 * at 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L383-L440),
 * ported; a **Reorder group** takes its drag direction from it. `Recognizer.drag`'s own
 * velocity keeps its 30 ms window.
 *
 * Tier 2 (ADR-0008): Effect-free, for binding and Environment authors.
 */
export const trailing = (history: ReadonlyArray<TimedPoint>, windowMs = 100): Point.Point =>
  Arr.match(history, {
    onEmpty: still,
    onNonEmpty: (samples) =>
      Bool.match(samples.length < 2, { onTrue: still, onFalse: () => velocityOver(samples, windowMs) }),
  })

/** No motion. */
const still = (): Point.Point => ({ x: 0, y: 0 })

/** Infinity as 0: a step in no time is no velocity. */
const finite = (v: number): number => Bool.match(v === Infinity, { onTrue: () => 0, onFalse: () => v })

/** The trailing velocity of two or more samples (see {@link trailing}). */
const velocityOver = (samples: Arr.NonEmptyReadonlyArray<TimedPoint>, windowMs: number): Point.Point => {
  const last = Arr.lastNonEmpty(samples)
  const age = (sample: TimedPoint): number => last.timeStamp - sample.timeStamp
  // The newest sample older than the window, else the oldest.
  const older = Option.getOrElse(
    Arr.findLast(samples, (sample) => age(sample) > windowMs),
    () => Arr.headNonEmpty(samples),
  )
  // An oldest sample far older than the window is a pause before the move: start from the next.
  const base = Bool.match(Bool.every([older === Arr.headNonEmpty(samples), samples.length > 2, age(older) > windowMs * 2]), {
    onTrue: () => Arr.getUnsafe(samples, 1),
    onFalse: () => older,
  })
  const seconds = (last.timeStamp - base.timeStamp) / 1000
  return Bool.match(seconds === 0, {
    onTrue: still,
    onFalse: () => ({ x: finite((last.x - base.x) / seconds), y: finite((last.y - base.y) / seconds) }),
  })
}
