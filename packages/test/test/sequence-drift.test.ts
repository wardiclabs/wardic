// An endless `animate` against wall time (#226, ADR-0028 *Amendment (#226)*): one time across every
// run, so a run starts the moment the one before it ends, wherever that falls in a tick, and a loop
// keeps wall time however long it runs. Before #226 each run started on the tick after the last one
// settled, so each restart dropped the rest of its tick: 0–1 frame a run, 11.6% slow for 0.12 s
// runs at 60 Hz.
//
// Frames at 60, 120 and 144 Hz with ±1% jitter (seeded), linear, so a restart is a drop and a turn a
// change of direction.
import * as Machine from "@wardic/core/Machine"
import * as Bool from "effect/Boolean"
import { describe, expect, it } from "vitest"
import { motionRunAt } from "./motion-oracle.ts"

const linear = (t: number): number => t

/** `n` frame intervals at `hz`, each off by up to ±1%, from a fixed seed. */
const jittered = (hz: number, n: number): Array<number> => {
  let seed = 7
  return Array.from({ length: n }, () => {
    seed = (seed * 16807) % 2147483647
    return (1 / hz) * (1 + 0.01 * (2 * (seed / 2147483647) - 1))
  })
}

describe("an endless animate keeps wall time over 30 runs (#226)", () => {
  for (const hz of [60, 120, 144]) {
    for (const duration of [0.12, 0.3, 1]) {
      for (const repeatType of ["loop", "reverse", "mirror"] as const) {
        it(`${hz} Hz, ${duration} s runs, ${repeatType}`, () => {
          const options = { duration, repeat: Number.POSITIVE_INFINITY, repeatType, ease: linear }
          const step = Machine.animate(0, 100, options).start()
          const dts = jittered(hz, Math.ceil(31 * duration * hz))
          let wall = 0
          let previous = 0
          let direction = 1
          let ends = 0
          let thirtieth = Number.NaN
          for (const dt of dts) {
            wall += dt
            const { value } = step(dt)
            // Each frame is Motion's at its wall time.
            expect(value, `at ${wall} s`).toBeCloseTo(motionRunAt(wall, 0, 100, { ...options, delay: 0, repeatDelay: 0 }), 9)
            // A run's end: a drop (a loop's restart), or a change of direction (a turn).
            const moved = Math.sign(value - previous)
            const ended = Bool.match(repeatType === "loop", {
              onTrue: () => value < previous - 50,
              onFalse: () => Bool.and(moved !== 0, moved !== direction),
            })
            if (moved !== 0) direction = moved
            if (ended) ends++
            if (ended && ends === 30) thirtieth = wall
            previous = value
          }
          // The frame that shows the 30th end is the first at or after 30 runs: within one frame of it. A
          // turn can show a frame later: the frame across it can still read past the one before it, if it
          // came back less far than that one was short of the turn.
          const frames = Bool.match(repeatType === "loop", { onTrue: () => 1, onFalse: () => 2 })
          expect(thirtieth - 30 * duration, "the 30th run's end, s after 30 runs").toBeGreaterThanOrEqual(0)
          expect(thirtieth - 30 * duration, "the 30th run's end, s after 30 runs").toBeLessThan((frames * 1.011) / hz)
        })
      }
    }
  }
})
