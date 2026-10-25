// Springs step in closed form (#370): Motion's exact solution (`motion-dom`'s `generators/spring.ts`,
// at 16c6122), as a matrix on the displacement and velocity, cached per spring config per `dt`.
//
// - CF1: a spring's path is framer-motion 13.4.0's, to 1e-6, at irregular frames: under-, critically
//   and over-damped, a mass of 2, and with a velocity either way; it rests within 1 ms of Motion's.
// - CF2: the path doesn't hang on the frame rate: 0.4 s at 1/30, 1/60, 1/120 or 1/250 s, or in one step,
//   lands on the same place and speed; a stall past `MAX_DT` steps its 0.5 s at once.
// - CF3: a heavily overdamped spring (damping 1,000,000) stays finite, creeping on its slow root.
// - CF4: a damping ratio of 1, or within 1e-9 of it, steps as critically damped, and the formulas
//   either side meet it: no jump at the band's edges.
// - CF5: a frame's velocity is the solution's exact derivative.
// - CF6: two runs on one spring config share its matrix: stepped turn about with different `dt`s,
//   each runs as it would alone.
// - CF7: `springValues`' keys each run as a `spring` of their own would.
// - CF8: a delay that ends partway through a frame: the spring moves for the part past it only, in
//   `spring` and in `springValues`.
import * as Machine from "@wardic/core/Machine"
import { describe, expect, it } from "vitest"

/** framer-motion 13.4.0's spring, 0 → 100, at 50, 100, 200, 300 and 400 ms, and when it's done (`370/spring-ref-370.mjs`). */
const MOTION: ReadonlyArray<{ readonly label: string; readonly options: Machine.SpringOptions; readonly at: ReadonlyArray<number>; readonly doneMs: number }> = [
  { label: "100/10/1", options: { stiffness: 100, damping: 10, mass: 1 }, at: [10.4405473455, 34.0299846608, 84.9425634854, 112.4354767408, 115.3122768414], doneMs: 1050 },
  { label: "170/26/1", options: { stiffness: 170, damping: 26, mass: 1 }, at: [13.9418259353, 37.5128590195, 73.5380481341, 90.2897543288, 96.6991639856], doneMs: 659 },
  { label: "500/25/1", options: { stiffness: 500, damping: 25, mass: 1 }, at: [39.0087378801, 89.4608325571, 109.8962965896, 99.2802634778, 99.3029248334], doneMs: 490 },
  { label: "550, critical", options: { stiffness: 550, damping: 2 * Math.sqrt(550), mass: 1 }, at: [32.7449124768, 67.9437829528, 94.7745666085, 99.2928898614, 100], doneMs: 397 },
  { label: "100/40/1, over", options: { stiffness: 100, damping: 40, mass: 1 }, at: [6.9705205902, 17.7736576098, 36.9639977722, 51.7775355991, 63.1123089552], doneMs: 2006 },
  { label: "300/10/2", options: { stiffness: 300, damping: 10, mass: 2 }, at: [16.7561743771, 56.574567352, 136.0776760379, 146.7559921347, 104.5780088088], doneMs: 2313 },
  { label: "170/26/1, 500 px/s", options: { stiffness: 170, damping: 26, mass: 1, velocity: 500 }, at: [26.9875330572, 51.1167490413, 80.9159891739, 93.2807012557, 97.7732896715], doneMs: 623 },
  { label: "100/10/1, −800 px/s", options: { stiffness: 100, damping: 10, mass: 1, velocity: -800 }, at: [-19.7470689325, -8.6505909483, 51.4001931121, 101.7760652194, 119.2746672208], doneMs: 1109 },
]

/** Motion's rest thresholds for a 100 px leg, given, so the oracle and the machine use the same. */
const REST = { restDelta: 0.5, restSpeed: 2 }

/** Irregular frames that land on 50, 100, 200, 300 and 400 ms. */
const FRAMES = [0.05, 0.05, 0.1, 0.1, 0.1]

/** A machine's Frames, one per `dts`. */
const framesOf = (machine: Machine.Machine<{ readonly value: number; readonly velocity: number; readonly done: boolean }>, dts: ReadonlyArray<number>) => {
  const step = machine.start()
  return dts.map((dt) => step(dt))
}

/** The exact path of a spring from `x0` at `v0` toward `target`, `t` seconds on, and its speed: the textbook solutions. */
const exactAt = (k: number, c: number, m: number, x0: number, v0: number, target: number, t: number): { readonly x: number; readonly v: number } => {
  const w0 = Math.sqrt(k / m)
  const ratio = c / (2 * Math.sqrt(k * m))
  const decay = c / (2 * m)
  const d = x0 - target
  if (ratio === 1) {
    const e = Math.exp(-w0 * t)
    return { x: target + e * (d + (v0 + w0 * d) * t), v: e * (v0 - w0 * (v0 + w0 * d) * t) }
  }
  if (ratio < 1) {
    const wd = w0 * Math.sqrt(1 - ratio * ratio)
    const e = Math.exp(-decay * t)
    return {
      x: target + e * (d * Math.cos(wd * t) + ((v0 + decay * d) / wd) * Math.sin(wd * t)),
      v: e * (v0 * Math.cos(wd * t) - ((decay * v0 + w0 * w0 * d) / wd) * Math.sin(wd * t)),
    }
  }
  const wh = w0 * Math.sqrt(ratio * ratio - 1)
  const [r1, r2] = [-decay + wh, -decay - wh]
  const a = (v0 - r2 * d) / (r1 - r2)
  const b = (r1 * d - v0) / (r1 - r2)
  return { x: target + a * Math.exp(r1 * t) + b * Math.exp(r2 * t), v: r1 * a * Math.exp(r1 * t) + r2 * b * Math.exp(r2 * t) }
}

describe("springs step in closed form (#370)", () => {
  it("CF1: a spring's path is framer-motion's at irregular frames, and it rests within 1 ms of Motion's", () => {
    for (const { label, options, at, doneMs } of MOTION) {
      const values = framesOf(Machine.spring(100, { ...options, ...REST }), FRAMES).map((f) => f.value)
      for (const [i, motion] of at.entries()) expect(values[i], `${label} at ${[50, 100, 200, 300, 400][i]} ms`).toBeCloseTo(motion, 6)
      // Stepped every millisecond, the frame it rests on.
      const step = Machine.spring(100, { ...options, ...REST }).start()
      let ms = 0
      while (ms < 5000 && !step(0.001).done) ms++
      expect(Math.abs(ms + 1 - doneMs), `${label} rests at ${doneMs} ms`).toBeLessThanOrEqual(1)
    }
  })

  it("CF2: the path doesn't hang on the frame rate, and a stall steps at once", () => {
    const options = { stiffness: 100, damping: 10, mass: 1, restDelta: 1e-9, restSpeed: 1e-9 }
    const after = (dt: number, n: number) => framesOf(Machine.spring(100, options), Array.from({ length: n }, () => dt)).at(-1)!
    const oneStep = after(0.4, 1)
    for (const [dt, n] of [[1 / 30, 12], [1 / 60, 24], [1 / 120, 48], [1 / 250, 100]] as const) {
      const f = after(dt, n)
      expect(f.value, `0.4 s at 1/${Math.round(1 / dt)}`).toBeCloseTo(oneStep.value, 9)
      expect(f.velocity, `its speed at 1/${Math.round(1 / dt)}`).toBeCloseTo(oneStep.velocity, 7)
    }
    expect(oneStep.value).toBeCloseTo(exactAt(100, 10, 1, 0, 0, 100, 0.4).x, 9)
    // A 2 s stall advances `MAX_DT`'s 0.5 s, in one step.
    expect(after(2, 1).value).toBeCloseTo(exactAt(100, 10, 1, 0, 0, 100, 0.5).x, 9)
  })

  it("CF3: a heavily overdamped spring stays finite, creeping on its slow root", () => {
    const values = framesOf(Machine.spring(100, { stiffness: 100, damping: 1e6 }), Array.from({ length: 30 }, () => 0.5)).map((f) => f.value)
    for (const v of values) expect(Number.isFinite(v)).toBe(true)
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!)
    expect(values.at(-1)!).toBeCloseTo(exactAt(100, 1e6, 1, 0, 0, 100, 15).x, 9)
  })

  it("CF4: a damping ratio of 1, or within 1e-9 of it, is critical, and the formulas either side meet it", () => {
    const critical = 2 * Math.sqrt(550)
    const path = (damping: number) => framesOf(Machine.spring(100, { stiffness: 550, damping, restDelta: 1e-9, restSpeed: 1e-9 }), FRAMES).map((f) => f.value)
    const exact = path(critical)
    for (const [i, t] of [0.05, 0.1, 0.2, 0.3, 0.4].entries()) expect(exact[i]).toBeCloseTo(exactAt(550, critical, 1, 0, 0, 100, t).x, 9)
    for (const nudge of [1 - 1e-12, 1 + 1e-12, 1 - 1e-8, 1 + 1e-8, 1 - 1e-6, 1 + 1e-6]) {
      const near = path(critical * nudge)
      for (const [i, x] of exact.entries()) expect(Math.abs(near[i]! - x), `damping × ${nudge} at frame ${i}`).toBeLessThan(1e-3)
    }
  })

  it("CF5: a frame's velocity is the solution's exact derivative", () => {
    for (const { label, options } of MOTION) {
      const { stiffness = 0, damping = 0, mass = 1, velocity = 0 } = options
      const frames = framesOf(Machine.spring(100, { ...options, restDelta: 1e-9, restSpeed: 1e-9 }), FRAMES)
      for (const [i, t] of [0.05, 0.1, 0.2, 0.3, 0.4].entries()) {
        expect(frames[i]!.velocity, `${label} at ${t * 1000} ms`).toBeCloseTo(exactAt(stiffness, damping, mass, 0, velocity, 100, t).v, 6)
      }
    }
  })

  it("CF6: two runs on one spring config share its matrix, and each runs as it would alone", () => {
    const options = { stiffness: 170, damping: 26, restDelta: 1e-9, restSpeed: 1e-9 }
    const alone = (dt: number) => framesOf(Machine.spring(100, options), Array.from({ length: 20 }, () => dt)).map((f) => f.value)
    const [a, b] = [Machine.spring(100, options).start(), Machine.spring(-50, options).start()]
    const together = Array.from({ length: 20 }, () => [a(1 / 60).value, b(1 / 30).value] as const)
    const soloB = framesOf(Machine.spring(-50, options), Array.from({ length: 20 }, () => 1 / 30)).map((f) => f.value)
    expect(together.map(([x]) => x)).toEqual(alone(1 / 60))
    expect(together.map(([, y]) => y)).toEqual(soloB)
  })

  it("CF7: springValues' keys each run as a spring of their own", () => {
    const options = { stiffness: 300, damping: 10, mass: 2, restDelta: 1e-9, restSpeed: 1e-9 }
    const step = Machine.springValues({ x: 100, y: -40 }, options, { x: 0, y: 10 }, { x: 200, y: 0 }).start()
    const both = Array.from({ length: 30 }, () => ({ ...step(1 / 60).value }))
    const x = framesOf(Machine.spring(100, { ...options, from: 0, velocity: 200 }), Array.from({ length: 30 }, () => 1 / 60)).map((f) => f.value)
    const y = framesOf(Machine.spring(-40, { ...options, from: 10 }), Array.from({ length: 30 }, () => 1 / 60)).map((f) => f.value)
    for (let i = 0; i < 30; i++) {
      expect(both[i]!.x).toBeCloseTo(x[i]!, 12)
      expect(both[i]!.y).toBeCloseTo(y[i]!, 12)
    }
  })

  it("CF8: a delay that ends partway through a frame moves the spring for the part past it only", () => {
    const options = { stiffness: 170, damping: 26, delay: 0.01, restDelta: 1e-9, restSpeed: 1e-9 }
    const one = framesOf(Machine.spring(100, options), [1 / 60, 1 / 60])
    expect(one[0]!.value, "1/60 − 0.01 s of it").toBeCloseTo(exactAt(170, 26, 1, 0, 0, 100, 1 / 60 - 0.01).x, 9)
    expect(one[1]!.value).toBeCloseTo(exactAt(170, 26, 1, 0, 0, 100, 2 / 60 - 0.01).x, 9)
    const step = Machine.springValues({ x: 100 }, options, { x: 0 }).start()
    expect(step(1 / 60).value.x, "springValues: the same").toBeCloseTo(exactAt(170, 26, 1, 0, 0, 100, 1 / 60 - 0.01).x, 9)
  })
})
