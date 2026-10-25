// Time-based springs (#359, ADR-0053): Motion's `duration`, `bounce` and `visualDuration`
// (`motion-dom`'s `spring.ts`, `getSpringOptions` and `findSpring`, at 16c6122).
//
// - TB1: each form solves to Motion's physics: the spring's exact path from Wardic's stiffness,
//   damping and mass is framer-motion 13.4.0's at 100 to 400 ms, to 1e-6; a duration spring runs
//   for its duration, a visual-duration spring to rest.
// - TB2: a machine on each form follows Motion's path, to 1e-6 (it steps in closed form, #370); a
//   duration spring lands on its target the frame its duration ends, a visual-duration one at rest.
// - TB3: precedence and limits: a stiffness, damping or mass wins (core's defaults for the rest), a
//   visual duration over a duration; a bounce alone is a 0.8 s spring, a visual duration alone a
//   bounce of 0 (Wardic's, #359 Q3: Motion's ignores it); a duration within 0.01 to 10 s, a damping
//   ratio within 0.05 to 1.
// - TB4: a duration spring starts from rest, whatever velocity it's handed (`spring`, `springValues`),
//   as Motion's; a visual-duration spring keeps it (Wardic's, #359 Q2: Motion's drops it too).
// - TB5: a chase on a duration spring starts its duration again, from rest, at a new target, as
//   Motion's `FollowAnimation` does: it lands a duration after the move, not at once.
// - TB6: `Easing.spring` on a duration spring: its curve is the run to that duration, ending on 1,
//   and named with it.
import * as Easing from "@wardic/core/Easing"
import * as Machine from "@wardic/core/Machine"
import * as Spring from "@wardic/core/Spring"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"

/** framer-motion 13.4.0's spring, 0 → 100, at 100, 200, 300 and 400 ms, and when it's done (`359/spring-ref.mjs`). */
const MOTION: ReadonlyArray<{ readonly label: string; readonly options: Machine.SpringOptions; readonly at: ReadonlyArray<number>; readonly doneMs: number }> = [
  { label: "visualDuration 0.5, bounce 0.25", options: { visualDuration: 0.5, bounce: 0.25 }, at: [31.8993420553, 72.9992232776, 95.2092986266, 102.2510988157], doneMs: 800 },
  { label: "duration 0.5, bounce 0.25", options: { duration: 0.5, bounce: 0.25 }, at: [65.7827638857, 100.5647593371, 102.14284182, 100.3065100163], doneMs: 500 },
  { label: "duration 0.5", options: { duration: 0.5 }, at: [71.4646520398, 103.9903063824, 102.1463299549, 99.9244658089], doneMs: 500 },
  { label: "bounce 0.25", options: { bounce: 0.25 }, at: [37.4048471208, 80.1178096421, 98.9980219774, 102.8321560591], doneMs: 800 },
  { label: "duration 0.5, bounce 0", options: { duration: 0.5, bounce: 0 }, at: [55.090837412, 88.3191039879, 97.4321560467, 99.4805110854], doneMs: 500 },
  { label: "duration 1.2, bounce 0.6", options: { duration: 1.2, bounce: 0.6 }, at: [51.8562492799, 113.1743963291, 123.8111670302, 106.6585009056], doneMs: 1200 },
]

/** The exact path of a spring from rest at 0 to 100 on `spring`'s physics, `t` seconds in. */
const exactAt = (spring: Spring.Resolved, t: number): number => {
  const w0 = Math.sqrt(spring.stiffness / spring.mass)
  const ratio = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass))
  if (ratio >= 1 - 1e-12) return 100 - Math.exp(-w0 * t) * (100 + w0 * 100 * t)
  const wd = w0 * Math.sqrt(1 - ratio * ratio)
  return 100 - Math.exp(-ratio * w0 * t) * (100 * Math.cos(wd * t) + ((ratio * w0 * 100) / wd) * Math.sin(wd * t))
}

/** `machine` stepped by `dt` until it's done (or 10 s): its values. */
const valuesOf = (machine: Machine.Machine<{ readonly value: number; readonly done: boolean }>, dt: number): Array<number> => {
  const step = machine.start()
  const out: Array<number> = []
  for (let i = 0; i < 10 / dt; i++) {
    const frame = step(dt)
    out.push(frame.value)
    if (frame.done) break
  }
  return out
}

/** Steps of 1/64 s: sums of them are exact, so a duration's last frame is the one it ends on. */
const F = 1 / 64

describe("time-based springs (#359)", () => {
  it("TB1: each form solves to Motion's physics; a duration spring runs for its duration, a visual-duration one to rest", () => {
    for (const { label, options, at } of MOTION) {
      const spring = Spring.resolve(options)
      for (const [i, motion] of at.entries()) expect(exactAt(spring, (i + 1) / 10), `${label} at ${(i + 1) * 100} ms`).toBeCloseTo(motion, 6)
      expect(spring.mass, label).toBe(1)
    }
    expect(Spring.resolve({ duration: 0.5, bounce: 0.25 }).duration).toBe(0.5)
    expect(Spring.resolve({ bounce: 0.25 }).duration).toBe(0.8)
    expect(Spring.resolve({ duration: 1.2, bounce: 0.6 }).duration).toBe(1.2)
    expect(Spring.resolve({ visualDuration: 0.5, bounce: 0.25 }).duration).toBe(Number.POSITIVE_INFINITY)
    expect(Spring.endsOnTime(Spring.resolve({ duration: 0.5 }))).toBe(true)
    expect(Spring.endsOnTime(Spring.resolve({ visualDuration: 0.5 }))).toBe(false)
    expect(Spring.endsOnTime(Spring.resolve({}))).toBe(false)
  })

  it("TB2: a machine on each form follows Motion's path; a duration spring lands the frame its duration ends, a visual-duration one at rest", () => {
    for (const { label, options, at, doneMs } of MOTION) {
      // One 1/240 s step a frame: the path at 100 ms is the 24th frame.
      const fine = valuesOf(Machine.spring(100, options), 1 / 240)
      for (const [i, motion] of at.entries()) expect(fine[24 * (i + 1) - 1], `${label} at ${(i + 1) * 100} ms`).toBeCloseTo(motion, 6)
      const values = valuesOf(Machine.spring(100, options), F)
      expect(values.at(-1), `${label} lands on its target`).toBe(100)
      if (Spring.endsOnTime(Spring.resolve(options))) {
        // The first frame at or past its duration (0.8 s is 51.2 frames).
        expect(values.length, `${label} ends at ${doneMs} ms`).toBe(Math.ceil((doneMs / 1000) * 64))
        expect(values.at(-2), `${label} still moving the frame before`).not.toBe(100)
      } else {
        // Motion's is done at 800 ms (its steps are 1 ms): at rest within a frame or two of it.
        expect(Math.abs(values.length / 64 - doneMs / 1000), `${label} at rest near ${doneMs} ms`).toBeLessThan(3 / 64)
      }
    }
    // With a delay: its duration runs after it.
    expect(valuesOf(Machine.spring(100, { duration: 0.5, delay: 0.25 }), F).length).toBe(48)
  })

  it("TB3: physics win, a visual duration over a duration; a bounce alone is 0.8 s, a visual duration alone no bounce; Motion's limits", () => {
    expect(Spring.resolve({ duration: 0.5, stiffness: 300 })).toMatchObject({ stiffness: 300, damping: 26, mass: 1, duration: Number.POSITIVE_INFINITY })
    expect(Spring.resolve({ bounce: 0.5, mass: 2 })).toMatchObject({ stiffness: 170, damping: 26, mass: 2, duration: Number.POSITIVE_INFINITY })
    expect(Spring.resolve({ visualDuration: 0.5, bounce: 0.25, duration: 2 })).toEqual(Spring.resolve({ visualDuration: 0.5, bounce: 0.25 }))
    expect(Spring.resolve({ bounce: 0.25 })).toEqual(Spring.resolve({ duration: 0.8, bounce: 0.25 }))
    expect(Spring.resolve({ duration: 0.5 })).toEqual(Spring.resolve({ duration: 0.5, bounce: 0.3 }))
    // A visual duration alone: Motion's closed form at a bounce of 0, critically damped.
    const alone = Spring.resolve({ visualDuration: 0.5 })
    expect(alone.stiffness).toBeCloseTo(((2 * Math.PI) / 0.6) ** 2, 9)
    expect(alone.damping).toBeCloseTo(2 * Math.sqrt(alone.stiffness), 9)
    expect(alone).toEqual(Spring.resolve({ visualDuration: 0.5, bounce: 0 }))
    // A duration within 0.01 to 10 s; a damping ratio within 0.05 to 1.
    expect(Spring.resolve({ duration: 20 })).toEqual(Spring.resolve({ duration: 10 }))
    expect(Spring.resolve({ duration: 0 })).toEqual(Spring.resolve({ duration: 0.01 }))
    expect(Spring.resolve({ duration: 0.5, bounce: 1.5 })).toEqual(Spring.resolve({ duration: 0.5, bounce: 0.99 }))
    expect(Spring.resolve({ duration: 0.5, bounce: -1 })).toEqual(Spring.resolve({ duration: 0.5, bounce: 0 }))
    const ratioOf = (spring: Spring.Resolved) => spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass))
    expect(ratioOf(Spring.resolve({ visualDuration: 0.5, bounce: 1.5 }))).toBeCloseTo(0.05, 9)
    expect(ratioOf(Spring.resolve({ visualDuration: 0.5, bounce: -1 }))).toBeCloseTo(1, 9)
  })

  it("TB4: a duration spring starts from rest whatever velocity it's handed; a visual-duration spring keeps it", () => {
    const timed = { duration: 0.5, bounce: 0.25 }
    expect(valuesOf(Machine.spring(100, { ...timed, velocity: 2000 }), F)).toEqual(valuesOf(Machine.spring(100, timed), F))
    const many = (velocity: number) => {
      const step = Machine.springValues({ x: 100, y: -50 }, timed, {}, { x: velocity, y: velocity }).start()
      return Array.from({ length: 32 }, () => ({ ...step(F).value }))
    }
    expect(many(2000), "springValues, each key").toEqual(many(0))
    expect(many(0).at(-1), "lands at its duration").toEqual({ x: 100, y: -50 })
    const visual = { visualDuration: 0.5, bounce: 0.25 }
    const handed = valuesOf(Machine.spring(100, { ...visual, velocity: 2000 }), F)
    expect(handed[0]! - valuesOf(Machine.spring(100, visual), F)[0]!, "ahead by its velocity's 1/64 s").toBeGreaterThan(20)
  })

  it("TB5: a chase on a duration spring starts its duration again, from rest, at a new target", () => {
    const timed = { duration: 0.5, bounce: 0.25 }
    let target = 100
    const step = Machine.chase(() => target, timed).start()
    const first = Array.from({ length: 64 }, () => step(F).value)
    expect(first[31], "lands at 0.5 s").toBe(100)
    expect(first.at(-1)).toBe(100)
    // Moved after it has landed: a fresh duration spring from 100, not a snap.
    target = 200
    const moved = Array.from({ length: 32 }, () => step(F).value)
    expect(moved).toEqual(valuesOf(Machine.spring(200, { ...timed, from: 100 }), F))
    expect(moved[30], "still on its way").not.toBe(200)
    // Moved mid-flight: from where it is, from rest, a whole duration again.
    target = 300
    let at = 0
    for (let i = 0; i < 16; i++) at = step(F).value
    target = 400
    const midFlight = Array.from({ length: 32 }, () => step(F).value)
    expect(midFlight).toEqual(valuesOf(Machine.spring(400, { ...timed, from: at }), F))
    expect(midFlight.at(-1), "lands 0.5 s after the move").toBe(400)
  })

  it("TB6: Easing.spring on a duration spring runs to that duration, ending on 1, and is named with it", () => {
    const options = { duration: 0.5, bounce: 0.25 }
    const curve = Easing.spring(options)
    // A fifth of the way: Motion's spring at 100 ms of 500, a sample on the exact path (#370).
    expect(curve(0.2) * 100).toBeCloseTo(65.7827638857, 6)
    expect(curve(0.6) * 100).toBeCloseTo(102.14284182, 6)
    // The machine's own path, sample for sample.
    const machine = valuesOf(Machine.spring(1, options), 1 / 240)
    expect(curve(0.2)).toBeCloseTo(machine[23]!, 9)
    expect(curve(0.6)).toBeCloseTo(machine[71]!, 9)
    expect(curve(1)).toBe(1)
    // On 1 at its end, as the machine lands: not where its steps put it there, a hair off.
    expect(curve(1 - 1e-9)).toBeCloseTo(1, 6)
    const { stiffness, damping } = Spring.resolve(options)
    expect(Option.getOrUndefined(Easing.nameOf(curve))).toBe(`spring(${stiffness},${damping},1,0.5)`)
    // A duration that isn't a whole number of 1/240 s steps: 74 steps of 0.31 / 74 s, ending on it.
    const odd = Spring.resolve({ duration: 0.31, bounce: 0.25 })
    expect(Easing.spring({ duration: 0.31, bounce: 0.25 })(0.5), "half way: 37 of its 74 steps").toBeCloseTo(exactAt(odd, 0.155) / 100, 9)
    expect(Option.getOrUndefined(Easing.nameOf(Easing.spring({ stiffness: 300 })))).toBe("spring(300,26,1)")
  })
})
