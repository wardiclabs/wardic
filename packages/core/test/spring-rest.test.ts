// A spring's rest thresholds (#344): Motion's, by how far each leg goes (`motion-dom`'s `spring.ts`,
// `springDefaults` and `setRestThresholds`, at `16c6122`).
//
// - SR1: the rule: a leg of 5 or more rests within 0.5 and 2/s, one shorter within 0.005 and 0.01/s;
//   a given threshold wins, each for itself; `scale` divides both (a layout's progress over 1000).
// - SR2: a spring over pixels rests sooner than 0.01 / 0.01 had it, on its target, its last frame
//   before the rest still outside the thresholds.
// - SR3: a granular leg (opacity) rests within 0.005 and 0.01/s, so later than 0.5 / 2 would.
// - SR4: `springValues` takes each key's thresholds by its own distance: each key beside another
//   lands on the frame it lands on alone (a 300 px move at 0.5 px after an opacity at 0.005, here).
// - SR5: a chase works its thresholds out again at each new target: a 2 px retarget rests within the
//   granular ones, later than held at the coarse ones.
// - SR6: a decay's speed threshold is `restSpeed`.
import * as Machine from "@wardic/core/Machine"
import * as Spring from "@wardic/core/Spring"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { describe, expect, it } from "vitest"

const F = 1 / 60

/** Step `machine` at 60 Hz until it's done (or 10 s): its Frames. */
const frames = <V,>(machine: Machine.Machine<{ readonly value: V; readonly done: boolean }>): Array<{ readonly value: V; readonly done: boolean }> => {
  const step = machine.start()
  const out: Array<{ readonly value: V; readonly done: boolean }> = []
  for (let i = 0; i < 600; i++) {
    const frame = step(F)
    // A `springValues` run rewrites its Frame's records (#111): kept as copies.
    const value = Bool.match(Predicate.isObject(frame.value), { onTrue: () => ({ ...frame.value }) as V, onFalse: () => frame.value })
    out.push({ value, done: frame.done })
    if (frame.done) break
  }
  return out
}

describe("a spring's rest thresholds (#344)", () => {
  it("SR1: Motion's rule, by distance; a given threshold wins, each for itself; scale divides both", () => {
    const spring = Spring.resolve({})
    expect(Spring.restFor(spring, 420)).toEqual({ delta: 0.5, speed: 2 })
    expect(Spring.restFor(spring, -5)).toEqual({ delta: 0.5, speed: 2 })
    expect(Spring.restFor(spring, 4.9)).toEqual({ delta: 0.005, speed: 0.01 })
    expect(Spring.restFor(spring, 0)).toEqual({ delta: 0.005, speed: 0.01 })
    expect(Spring.restFor(Spring.resolve({ restDelta: 3 }), 420)).toEqual({ delta: 3, speed: 2 })
    expect(Spring.restFor(Spring.resolve({ restSpeed: 20 }), 1)).toEqual({ delta: 0.005, speed: 20 })
    // A layout's progress, 0 → 1, rests as Motion's 0 → 1000 does, its own thresholds in those units.
    expect(Spring.restFor(spring, 1000, 1000)).toEqual({ delta: 0.0005, speed: 0.002 })
    expect(Spring.restFor(Spring.resolve({ restDelta: 1 }), 1000, 1000).delta).toBeCloseTo(0.001, 12)
  })

  it("SR2: a spring over pixels rests sooner, on its target, the frame before still outside the thresholds", () => {
    const options = { stiffness: 300, damping: 35 }
    const motions = frames(Machine.spring(420, options))
    const tight = frames(Machine.spring(420, { ...options, restDelta: 0.01, restSpeed: 0.01 }))
    expect(motions.at(-1)).toEqual({ value: 420, done: true })
    expect(motions.length, `${motions.length} frames against ${tight.length}`).toBeLessThan(tight.length)
    // The frame before the rest: farther than 0.5 px, or faster than 2 px/s.
    const step = Machine.spring(420, options).start()
    let last = { value: 0, velocity: 0, done: false }
    for (let i = 0; i < motions.length - 1; i++) last = step(F)
    expect(Math.abs(420 - last.value) > 0.5 || Math.abs(last.velocity) > 2, `before the rest: ${last.value}, ${last.velocity}/s`).toBe(true)
  })

  it("SR3: a granular leg rests within 0.005 and 0.01/s, later than 0.5 / 2 would", () => {
    const granular = frames(Machine.spring(1, {}))
    const coarse = frames(Machine.spring(1, { restDelta: 0.5, restSpeed: 2 }))
    expect(granular.length).toBeGreaterThan(coarse.length)
    const step = Machine.spring(1, {}).start()
    let last = { value: 0, velocity: 0, done: false }
    for (let i = 0; i < granular.length - 1; i++) last = step(F)
    expect(Math.abs(1 - last.value) > 0.005 || Math.abs(last.velocity) > 0.01).toBe(true)
  })

  it("SR4: springValues takes each key's thresholds by its own distance", () => {
    const together = frames(Machine.springValues({ x: 300, opacity: 1 }, {}, { from: { x: 0, opacity: 0 } }))
    const x = frames(Machine.spring(300, {}))
    const opacity = frames(Machine.spring(1, {}))
    /** The frame a key first sits on its target, from which it stays. */
    const landing = (values: ReadonlyArray<number>, target: number): number => values.findIndex((_, i) => values.slice(i).every((w) => w === target))
    expect(landing(together.map((f) => f.value.x!), 300), "x, as alone").toBe(x.length - 1)
    expect(landing(together.map((f) => f.value.opacity!), 1), "opacity, as alone").toBe(opacity.length - 1)
    expect(x.length, "each by its own thresholds").not.toBe(opacity.length)
    expect(together.length, "done when the later key is").toBe(Math.max(x.length, opacity.length))
  })

  it("SR5: a chase works its thresholds out again at each new target: a 2 px retarget rests within the granular ones", () => {
    /** Frames to rest after a chase at rest at 100 is retargeted to 102. */
    const afterRetarget = (options: Machine.SpringOptions): number => {
      let target = 100
      const step = Machine.chase(() => target, options).start()
      let frame = step(F)
      for (let i = 0; i < 600 && !frame.done; i++) frame = step(F)
      expect(frame.value, "at rest at 100").toBe(100)
      target = 102
      for (let i = 1; i < 600; i++) {
        frame = step(F)
        if (frame.done) {
          expect(frame.value).toBe(102)
          return i
        }
      }
      return Number.NaN
    }
    // The defaults: coarse for 0 → 100, granular (0.005, 0.01/s) once retargeted 2 px; held at the
    // coarse 0.5 and 2/s throughout, the same retarget rests sooner.
    expect(afterRetarget({})).toBeGreaterThan(afterRetarget({ restDelta: 0.5, restSpeed: 2 }))
  })

  it("SR6: a decay's speed threshold is restSpeed", () => {
    const slow = frames(Machine.decay(0, 1000, { restSpeed: 50 }))
    const fine = frames(Machine.decay(0, 1000, { restSpeed: 0.1 }))
    expect(slow.length).toBeLessThan(fine.length)
  })
})
