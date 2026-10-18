// The inertia Primitive (#140, ADR-0016 *Amendment (#140)*), Motion's `inertia` generator: a glide
// toward `power` × the velocity easing out over `timeConstant`, and a spring back to an edge it would
// cross or starts past. Stepped by hand at 1/60 s, checked against Motion's closed form and, for the
// bounces, against Motion's own generator's frames (motion-dom 13.3.0, `.tmp/140/motion-fixtures.ts`,
// copied here as literals: the probe's install is gitignored), with a drag release's options.
import * as Machine from "@wardic/core/Machine"
import { describe, expect, it } from "vitest"

const DT = 1 / 60

/** Each frame's value, velocity and done until it's done (or `limit` frames). */
const run = (machine: Machine.Machine<{ readonly value: number; readonly velocity: number; readonly done: boolean }>, limit = 1200) => {
  const step = machine.start()
  const frames: Array<{ value: number; velocity: number; done: boolean }> = []
  for (let i = 0; i < limit; i++) {
    const f = step(DT)
    frames.push({ value: f.value, velocity: f.velocity, done: f.done })
    if (f.done) break
  }
  return frames
}

/** A drag's release (Motion's `dragTransition` defaults), in seconds. */
const RELEASE = { power: 0.8, timeConstant: 0.75, restDelta: 1, restSpeed: 10 }

/** Motion's inertia generator's frames at 1/60 s: the first 8, the frame it's done on, and the edge it rests on. */
const MOTION = {
  crossMax: { initial: 72, velocity: 1000, options: { max: 100, bounceStiffness: 200, bounceDamping: 40 }, edge: 100, doneAt: 41, first: [89.5817020123196, 106.777008717577, 118.922844200292, 124.394949472529, 126.219779184663, 126.098380372704, 124.982654486752, 123.401457621258] },
  startPast: { initial: 60, velocity: 300, options: { min: 0, max: 0, bounceStiffness: 200, bounceDamping: 40 }, edge: 0, doneAt: 46, first: [62.5123057989714, 61.2790093983578, 58.1724357174696, 54.2294787042519, 50.016256041492, 45.8343308546315, 41.8372675682354, 38.0964472856853] },
  underdamped: { initial: 72, velocity: 1000, options: { max: 100, bounceStiffness: 500, bounceDamping: 10 }, edge: 100, doneAt: 48, first: [89.5817020123196, 106.777008717577, 121.640074869884, 131.48481254664, 135.836673941148, 134.988585118399, 129.846081694477, 121.718749198862] },
  critical: { initial: 72, velocity: 1000, options: { max: 100, bounceStiffness: 100, bounceDamping: 20 }, edge: 100, doneAt: 42, first: [89.5817020123196, 106.777008717577, 121.087100313366, 130.843751154224, 137.107775734512, 140.721594583659, 142.351288067416, 142.520885213608] },
  minEdge: { initial: -60, velocity: -500, options: { min: -100, bounceStiffness: 200, bounceDamping: 40 }, edge: -100, doneAt: 36, first: [-68.7908510061598, -77.3885043587883, -85.7972059873529, -94.0211085079876, -102.064273274252, -107.770310315928, -110.386257734910, -111.310113886152] },
} as const

/** Motion's glide at `t` seconds: `target − amplitude · e^(−t / τ)`. */
const glide = (initial: number, target: number, tau: number, t: number): number => target - (target - initial) * Math.exp(-t / tau)

describe("inertia", () => {
  it("glides toward initial + power × velocity on Motion's curve, and rests on it within restDelta", () => {
    // A drag's release: power 0.8, a 0.75 s time constant, restDelta 1 (Motion's dragTransition).
    const frames = run(Machine.inertia(100, 1000, { power: 0.8, timeConstant: 0.75, restDelta: 1 }))
    const target = 100 + 0.8 * 1000
    for (const [k, f] of frames.slice(0, -1).entries()) expect(f.value, `frame ${k + 1}`).toBeCloseTo(glide(100, target, 0.75, (k + 1) * DT), 9)
    const last = frames.at(-1)!
    expect(last.done).toBe(true)
    expect(last.value, "rests on its target").toBe(target)
    // It rests once within 1 of it: 800 · e^(−t / 0.75) ≤ 1 at t = 0.75 · ln 800 ≈ 5.01 s.
    expect(frames.length).toBe(Math.ceil((0.75 * Math.log(800)) / DT))
    // Its speed is the glide's derivative: amplitude / τ · e^(−t / τ).
    expect(frames[0]!.velocity).toBeCloseTo((800 / 0.75) * Math.exp(-DT / 0.75), 9)
  })

  it("moves its resting point with modifyTarget, and glides there from where it starts", () => {
    const toGrid = (ideal: number): number => Math.round(ideal / 50) * 50
    const frames = run(Machine.inertia(0, 230, { power: 0.8, timeConstant: 0.75, restDelta: 1, modifyTarget: toGrid }))
    // 0.8 × 230 = 184: snapped to 200.
    expect(frames.at(-1)!.value).toBe(200)
    expect(frames[0]!.value).toBeCloseTo(glide(0, 200, 0.75, DT), 9)
  })

  it("rests where it is with no velocity inside its edges", () => {
    const frames = run(Machine.inertia(40, 0, { min: 0, max: 100 }))
    expect(frames).toEqual([{ value: 40, velocity: 0, done: true }])
  })

  for (const [name, c] of Object.entries(MOTION)) {
    it(`springs back to an edge as Motion's generator does, frame for frame: ${name}`, () => {
      const frames = run(Machine.inertia(c.initial, c.velocity, { ...RELEASE, ...c.options }))
      for (const [k, v] of c.first.entries()) expect(frames[k]!.value, `frame ${k + 1}`).toBeCloseTo(v, 9)
      expect(frames.length, "done on Motion's frame").toBe(c.doneAt)
      expect(frames.at(-1)!).toMatchObject({ value: c.edge, done: true })
    })
  }

  it("never steps a NaN: a NaN bounce stiffness is rejected before any step, naming it (#66)", () => {
    expect(() => run(Machine.inertia(60, 0, { min: 0, max: 0, bounceStiffness: Number.NaN }), 5)).toThrow(/bounceStiffness/)
  })

  it("on a near-rigid wall (Motion's 1e6 / 1e7 with no elastic), stops at the edge", () => {
    // Motion's: 89.58, the crossing frame at 106.78, then on the edge, done.
    const frames = run(Machine.inertia(72, 1000, { ...RELEASE, bounceStiffness: 1e6, bounceDamping: 1e7, max: 100 }))
    expect(frames.map((f) => Number(f.value.toFixed(3)))).toEqual([89.582, 106.777, 100])
    expect(frames.at(-1)!.done).toBe(true)
  })
})

describe("inertiaVec", () => {
  const BOTH = { ...RELEASE, bounceStiffness: 200, bounceDamping: 40 }

  it("steps both axes, each with its own edges, frame for frame each axis's inertia, and settles once both rest", () => {
    const step = Machine.inertiaVec({ x: 20, y: 0 }, { x: 600, y: -300 }, { ...BOTH, x: { max: 100 }, y: { min: -100 } }).start()
    const x = run(Machine.inertia(20, 600, { ...BOTH, max: 100 }))
    const y = run(Machine.inertia(0, -300, { ...BOTH, min: -100 }))
    const frames: Array<{ x: number; y: number; done: boolean }> = []
    for (let i = 0; i < 1200; i++) {
      const f = step(DT)
      frames.push({ ...f.value, done: f.done })
      if (f.done) break
    }
    expect(frames.length, "done once the slower axis is").toBe(Math.max(x.length, y.length))
    for (const [k, f] of frames.entries()) {
      expect(f.x, `frame ${k + 1}: x`).toBeCloseTo(x[Math.min(k, x.length - 1)]!.value, 9)
      expect(f.y, `frame ${k + 1}: y`).toBeCloseTo(y[Math.min(k, y.length - 1)]!.value, 9)
    }
    expect(frames.at(-1)!).toEqual({ x: 100, y: -100, done: true })
  })

  it("rests on its glide with no edges: y glides to 0.8 × −300", () => {
    const step = Machine.inertiaVec({ x: 20, y: 0 }, { x: 0, y: -300 }, BOTH).start()
    let last = step(DT)
    for (let i = 0; i < 1200 && !last.done; i++) last = step(DT)
    expect(last.value).toEqual({ x: 20, y: -240 })
  })
})
