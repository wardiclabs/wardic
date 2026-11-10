/**
 * A playhead the machines of one animation share, so they play, pause, seek, change speed or run
 * backwards together: `make` one, `drive` each machine through it, then `pause`, `play`, `setSpeed` or
 * `seek` it. It's what `createAnimate`'s playback controls run on.
 *
 * @example
 * import * as Machine from "@wardic/core/Machine"
 * import * as Playback from "@wardic/core/Playback"
 *
 * const head = Playback.make()
 * const x = Machine.tween(0, 200, { duration: 1 }).pipe(Playback.drive(head))
 * Playback.setSpeed(head, 0.5) // slow motion
 * Playback.pause(head) // held where it is
 */
// #433, Motion's playback controls. Machines step by `dt` (a design principle), so a time is reached by
// starting a machine partway through (`Machine.startAt`), as an Appear animation's Handoff is
// (ADR-0044). Tier 2 (ADR-0008): for binding authors.
import * as Arr from "effect/Array"
import { constant } from "effect/Function"
import * as Inspectable from "effect/Inspectable"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Frame from "./Frame.ts"
import * as Machine from "./Machine.ts"
import { measuredAs } from "./internal/driven.ts"
import { dual } from "./internal/dual.ts"
import { tickOf, writableOf } from "./internal/playhead.ts"

const TypeId = "~@wardic/core/Playback"

/**
 * What the machines of one animation read each frame: its `time`, its `speed`, and whether it's
 * `paused`. Each machine driven through it moves `time` as it steps; {@link pause}, {@link play},
 * {@link setSpeed} and {@link seek} control them all.
 */
// Read-only to its users (#618, F1): the machines and this module's operations write it.
export interface Playhead extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  /** Seconds played, a delay included: each driven machine moves it as it steps. A seek moves it, then the machines start again. */
  readonly time: number
  /** Each tick's `dt` is scaled by it: 1 as given, 0 holds, below 0 plays backwards. */
  readonly speed: number
  /** Whether the machines hold where they are. */
  readonly paused: boolean
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

/** A playhead at 0, playing at speed 1. */
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
  if (Predicate.isObject(velocity)) {
    const held = { ...frame, velocity: Rec.map(velocity as Record<string, number>, ZERO) }
    // `springValues`' by index too (#663), its arrays its own: the run rewrites its own when it resumes.
    if (Frame.isSpringValues(held as unknown as Frame.MultiPhysics)) {
      const spring = held as unknown as Frame.SpringValues
      return { ...held, positions: Arr.copy(spring.positions), velocities: Arr.map(spring.velocities, ZERO) }
    }
    return held
  }
  return frame
}

const ZERO = constant(0)

/** `frame`, settled: a backwards run's at 0 (cold, once). */
const settled = <F extends Frame.Frame<unknown>>(frame: F): F => ({ ...frame, done: true })

/**
 * `self` driven through `head`:
 * - **It starts where `head.time` is,** its first frame landing there, so a machine started after a
 *   seek starts at the seek's time.
 * - **Each frame's `dt` is scaled by `head.speed`,** and the machine sets `head.time` as it goes, so
 *   machines started together keep one time.
 * - **While `head.paused`,** it holds its last frame, with a velocity of 0.
 * - **Below speed 0,** it runs backwards, and settles at 0.
 *
 * It keeps `self`'s span, and whether it settles.
 *
 * @example
 * const driven = Machine.spring(1).pipe(Playback.drive(head))
 */
// #433. Each step is at most Machine.MAX_DT either way. Held, a velocity reads 0, as a held
// MotionValue's frames read in Motion (#464), made once per pause. Backwards, each tick starts it again
// at the time it went back to, a run of `time × 60` steps.
export const drive: {
  (head: Playhead): <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>) => Machine.Machine<F>
  <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>, head: Playhead): Machine.Machine<F>
} = dual(
  2,
  <F extends Frame.Frame<unknown>>(self: Machine.Machine<F>, head: Playhead): Machine.Machine<F> =>
    measuredAs(Machine.make({
      settles: self.settles,
      span: self.span,
      start: () => {
        const writable = writableOf(head)
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
            writable.time = time
            return last
          }
          if (head.paused) {
            if (Predicate.isUndefined(last)) last = step(0)
            if (Predicate.isUndefined(held)) held = heldOf(last)
            return held
          }
          held = undefined
          const by = tickOf(head, dt, Machine.MAX_DT)
          if (by >= 0) {
            time += by
            writable.time = time
            last = step(by)
            return last
          }
          time = Math.max(0, time + by)
          writable.time = time
          step = runFrom(self, time)
          last = step(0)
          if (time === 0) return settled(last)
          return last
        }
      },
    }), self),
)

/**
 * Moves `head` to `time` seconds, 0 at least: the machines driven through it start there when they're
 * next started.
 *
 * @example
 * Playback.seek(head, 0.5) // then start the machines again
 */
export const seek: {
  (time: number): (head: Playhead) => void
  (head: Playhead, time: number): void
} = dual(2, (head: Playhead, time: number): void => {
  const writable = writableOf(head)
  writable.time = Math.max(0, time)
})

/**
 * Scales each tick's `dt` for the machines driven through `head` by `speed`: 1 as given, 0 holds, below
 * 0 plays backwards.
 *
 * @example
 * Playback.setSpeed(head, 0.5) // slow motion
 */
// #618 (F1).
export const setSpeed: {
  (speed: number): (head: Playhead) => void
  (head: Playhead, speed: number): void
} = dual(2, (head: Playhead, speed: number): void => {
  const writable = writableOf(head)
  writable.speed = speed
})

/** Holds the machines driven through `head` where they are. */
// #618 (F1).
export const pause = (head: Playhead): void => {
  const writable = writableOf(head)
  writable.paused = true
}

/** Plays the machines driven through `head` on from where they're held. */
// #618 (F1).
export const play = (head: Playhead): void => {
  const writable = writableOf(head)
  writable.paused = false
}
