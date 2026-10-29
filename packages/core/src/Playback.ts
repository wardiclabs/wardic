/**
 * The `Playback` module (#433, Motion's playback controls): a **Playhead** the machines of one
 * **Imperative animation** share, and a machine driven through it ({@link drive}): held, played at
 * a speed, backwards, or from a time it was sought to. Machines step by `dt` (a design principle),
 * so a time is reached by starting a machine partway through (`Machine.startAt`), as an Appear
 * animation's Handoff is (ADR-0044).
 *
 * Tier 2 (ADR-0008): for binding authors.
 */
import { constant, dual } from "effect/Function"
import * as Inspectable from "effect/Inspectable"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import type * as Frame from "./Frame.ts"
import * as Machine from "./Machine.ts"

const TypeId = "~@wardic/core/Playback"

/**
 * What the machines of one Imperative animation read each tick: mutable, and read per frame. A
 * binding's playback controls write it; each machine driven through it ({@link drive}) keeps `time`.
 */
export interface Playhead extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  /** Seconds played, a delay included: each driven machine sets it as it steps. A seek sets it, then starts the machines again. */
  time: number
  /** Each tick's `dt` is scaled by it: 1 as given, 0 holds, below 0 plays backwards. */
  speed: number
  /** Whether the machines hold where they are. */
  paused: boolean
}

const Proto = {
  [TypeId]: TypeId,
  ...Inspectable.BaseProto,
  toJSON(this: Playhead) {
    return { _id: "Playhead", time: this.time, speed: this.speed, paused: this.paused }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/** A Playhead at 0, playing at speed 1. */
export const make = (): Playhead => {
  const head = Object.create(Proto)
  head.time = 0
  head.speed = 1
  head.paused = false
  return head
}

/** Whether `u` is a Playhead. */
export const isPlayhead = (u: unknown): u is Playhead => Predicate.hasProperty(u, TypeId)

/** A run of `self` from `at` seconds in: its first tick lands there (`Machine.startAt`), or from its start at 0. */
const runFrom = <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>, at: number): ((dt: number) => F) => {
  if (at > 0) return Machine.startAt(self, constant(at)).start()
  return self.start()
}

/**
 * `frame`, held (#464): its values, moving nothing. A velocity it gives, one number or one per key,
 * reads 0. Once per pause.
 */
const heldOf = <F extends Frame.Frame<unknown>>(frame: F): F => {
  const velocity: unknown = (frame as { readonly velocity?: unknown }).velocity
  if (Predicate.isNumber(velocity)) return { ...frame, velocity: 0 }
  if (Predicate.isObject(velocity)) return { ...frame, velocity: Rec.map(velocity as Record<string, number>, ZERO) }
  return frame
}

const ZERO = constant(0)

/** `frame`, settled: a backwards run's at 0 (cold, once). */
const settled = <F extends Frame.Frame<unknown>>(frame: F): F => ({ ...frame, done: true })

/**
 * `self` driven through `head` (#433):
 * - **Started at `head.time`:** a run started after a seek starts there, its first tick landing
 *   there (`Machine.startAt`); one started at 0 steps as `self` does.
 * - **Each tick's `dt`** is scaled by `head.speed`, at most `Machine.MAX_DT` a step either way, and
 *   added to its time, which it sets on `head`, so the machines of one head, started on one tick,
 *   keep its time together.
 * - **Held** while `head.paused`: the Frame it drew last, again, moving nothing: a velocity it gives
 *   reads 0 (#464), as a held MotionValue's frames read in Motion. Made once per pause.
 * - **Backwards** below speed 0: each tick starts it again at the time it went back to, a run of
 *   `time × 60` steps; it settles at 0.
 *
 * Keeps `self`'s span and whether it settles.
 */
export const drive: {
  (head: Playhead): <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>) => Machine.Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>, head: Playhead): Machine.Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>, head: Playhead): Machine.Machine<F> =>
    Machine.make({
      settles: self.settles,
      span: self.span,
      start: () => {
        const at = head.time
        let time = at
        let step = runFrom(self, at)
        // Its first tick lands at `at` when it starts partway through, whatever the `dt`.
        let landing = at > 0
        let last: F | undefined
        let held: F | undefined
        // Per frame (ADR-0025): statement `if`s, `Math.min` / `Math.max`.
        return (dt) => {
          if (landing) {
            landing = false
            last = step(0)
            head.time = time
            return last
          }
          if (head.paused) {
            if (Predicate.isUndefined(last)) last = step(0)
            if (Predicate.isUndefined(held)) held = heldOf(last)
            return held
          }
          held = undefined
          const by = Math.max(-Machine.MAX_DT, Math.min(Machine.MAX_DT, dt * head.speed))
          if (by >= 0) {
            time += by
            head.time = time
            last = step(by)
            return last
          }
          time = Math.max(0, time + by)
          head.time = time
          step = runFrom(self, time)
          last = step(0)
          if (time === 0) return settled(last)
          return last
        }
      },
    }),
)

/** Seek `head` to `time` seconds (0 at least): the machines started through it next start there. */
export const seek: {
  (time: number): (head: Playhead) => void
  (head: Playhead, time: number): void
} = dual(2, (head: Playhead, time: number): void => {
  head.time = Math.max(0, time)
})
