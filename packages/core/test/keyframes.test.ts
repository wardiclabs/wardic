// Keyframes (#429, ADR-0058): `keyframes` through numbers and `keyframesValues` through a bag of any
// kinds, each stop at its place in `times`, an `ease` per Segment, and `animate`'s repeat modifiers
// over the whole run, as Motion's keyframes. The references are Motion's own: motion-dom 14.6.0's
// `JSAnimation`, sampled (`.tmp/429/motion-ref.cjs`), at times a 1/32 s step reaches exactly.
//
// - KF1: evenly spaced stops, linear, are Motion's.
// - KF2: `times` places each stop; `times` of another length leaves them evenly spaced.
// - KF3: an `ease` per Segment, with `times`, is Motion's (to its bézier solver's 5.6e-4, ME1).
// - KF4: a Segment with no length jumps to its end, the last one at the run's.
// - KF5: `repeat` with `repeatDelay` loops, reverses and mirrors the whole run as Motion's, and
//   settles on Motion's last value.
// - KF6: `reverse` reads the stops from last to first.
// - KF7: `repeat: Infinity` never settles.
// - KF8: a single stop holds, and none holds at 0, for the duration.
// - KF9: `keyframesValues` runs each key through its own stops on one run: unit strings are
//   Motion's, and a key with two stops is evenly spaced beside one with three.
// - KF10: `times` applies to each key with one per stop, the rest evenly spaced.
// - KF11: `keyframesValues` through numbers is `keyframes`, looped, reversed, mirrored and flipped.
// - KF12: a key with one stop holds it, one with none is left out, and a Discrete pair switches at
//   its Segment's first Frame.
// - KF13: `delay` holds once, before the first Segment, across the repeats.
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"

/** A step that sums exactly to every sample time below. */
const STEP = 1 / 32

/** `machine`'s Frames at each of `seconds`, stepped by {@link STEP} from one start. */
const framesAt = <F>(machine: Machine.Machine<{ readonly value: F; readonly done: boolean }>, seconds: ReadonlyArray<number>): ReadonlyArray<{ readonly value: F; readonly done: boolean }> => {
  const step = machine.start()
  let elapsed = 0
  let frame = { value: undefined as F, done: false }
  return seconds.map((t) => {
    while (elapsed < t) {
      frame = step(STEP)
      elapsed += STEP
    }
    return frame
  })
}

/** `machine`'s values at each of `seconds`. */
const valuesAt = <F>(machine: Machine.Machine<{ readonly value: F; readonly done: boolean }>, seconds: ReadonlyArray<number>): ReadonlyArray<F> =>
  framesAt(machine, seconds).map((frame) => frame.value)

/** A bag's machine, built on core's InterpolatorRegistry. */
const bag = (stops: Readonly<Record<string, ReadonlyArray<number | string>>>, options?: Machine.KeyframesOptions): Machine.Machine<{ readonly value: Values.Values; readonly done: boolean }> =>
  Effect.runSync(Effect.provide(Machine.keyframesValues(stops, options), InterpolatorRegistry.layer))

/** Each value close to Motion's, to `digits`. */
const closeTo = (actual: ReadonlyArray<number>, motion: ReadonlyArray<number>, digits: number): void => {
  expect(actual.length).toBe(motion.length)
  actual.forEach((value, i) => expect(value, `sample ${i}`).toBeCloseTo(motion[i], digits))
}

const STOPS = [0, 100, 40]
const EASES = { duration: 1, ease: ["easeIn", "easeOut"], times: [0, 0.3, 1] } as const
const REPEAT_AT = [0.15625, 0.8125, 1.125, 1.34375, 2, 2.53125, 3.28125, 3.40625]

describe("keyframes (#429)", () => {
  it("KF1: evenly spaced stops, linear, are Motion's", () => {
    closeTo(valuesAt(Machine.keyframes(STOPS, { duration: 1 }), [0.125, 0.25, 0.5, 0.625, 0.75, 1]), [25, 50, 100, 85, 70, 40], 9)
  })

  it("KF2: times places each stop; times of another length leaves them evenly spaced", () => {
    closeTo(valuesAt(Machine.keyframes(STOPS, { duration: 1, times: [0, 0.2, 1] }), [0.125, 0.25, 0.375, 0.625, 1]), [62.5, 96.25, 86.875, 68.125, 40], 9)
    closeTo(valuesAt(Machine.keyframes(STOPS, { duration: 1, times: [0, 1] }), [0.25, 0.5, 0.75]), [50, 100, 70], 9)
  })

  it("KF3: an ease per Segment, with times, is Motion's", () => {
    closeTo(valuesAt(Machine.keyframes(STOPS, EASES), [0.15625, 0.3125, 0.5, 0.8125]), [33.80158442111903, 98.20104021770608, 74.42143225197587, 46.34927328255813], 1)
  })

  it("KF4: a Segment with no length jumps to its end", () => {
    const machine = Machine.keyframes([0, 100, 0, 50], { duration: 1, times: [0, 0.5, 0.5, 1] })
    closeTo(valuesAt(machine, [0.25, 0.46875, 0.5, 0.53125, 0.75, 1]), [50, 93.75, 0, 3.125, 25, 50], 9)
    // The last Segment with no length: its end at the run's.
    closeTo(valuesAt(Machine.keyframes(STOPS, { duration: 1, times: [0, 1, 1] }), [0.5, 0.96875, 1]), [50, 96.875, 40], 9)
  })

  it("KF5: repeat with repeatDelay loops, reverses and mirrors the whole run as Motion's, and settles on its last value", () => {
    const motion = {
      loop: [33.80158442111903, 46.34927328255813, 40, 29.327156251712104, 47.12703442123102, 25.08838473256365, 42.75894610044252, 40],
      reverse: [33.80158442111903, 46.34927328255813, 40, 43.92229566650172, 51.165099728982646, 25.08838473256365, 42.75894610044252, 40],
      mirror: [33.80158442111903, 46.34927328255813, 40, 57.59629375102726, 11.878390702051718, 25.08838473256365, 42.75894610044252, 40],
    } as const
    for (const repeatType of ["loop", "reverse", "mirror"] as const) {
      const frames = framesAt(Machine.keyframes(STOPS, { ...EASES, repeat: 2, repeatType, repeatDelay: 0.2 }), REPEAT_AT)
      closeTo(frames.map((frame) => frame.value), motion[repeatType], 1)
      // Three passes of 1 s and two gaps of 0.2 s: 3.4 s.
      expect(frames.map((frame) => frame.done), repeatType).toEqual([false, false, false, false, false, false, false, true])
    }
  })

  it("KF6: reverse reads the stops from last to first", () => {
    const at = [0.125, 0.25, 0.5, 0.75, 1]
    expect(valuesAt(Machine.keyframes(STOPS, { ...EASES, reverse: true }), at)).toEqual(valuesAt(Machine.keyframes([40, 100, 0], EASES), at))
  })

  it("KF7: repeat: Infinity never settles", () => {
    const machine = Machine.keyframes(STOPS, { duration: 0.5, repeat: Infinity, repeatType: "mirror" })
    expect(machine.settles).toBe(false)
    const frames = framesAt(machine, [0.25, 10.25])
    expect(frames.map((frame) => frame.done)).toEqual([false, false])
    expect(frames[1].value).toBeCloseTo(frames[0].value, 9)
  })

  it("KF8: a single stop holds, and none holds at 0, for the duration", () => {
    expect(framesAt(Machine.keyframes([7], { duration: 0.5 }), [0.25, 0.5])).toEqual([{ value: 7, done: false }, { value: 7, done: true }])
    expect(framesAt(Machine.keyframes([], { duration: 0.5 }), [0.25, 0.5])).toEqual([{ value: 0, done: false }, { value: 0, done: true }])
  })

  it("KF9: keyframesValues runs each key through its own stops on one run", () => {
    const frames = framesAt(bag({ x: ["0px", "100px", "40px"], opacity: [0, 1] }, { duration: 1 }), [0.25, 0.75, 1])
    expect(frames.map((frame) => frame.value)).toEqual([{ x: "50px", opacity: 0.25 }, { x: "70px", opacity: 0.75 }, { x: "40px", opacity: 1 }])
    expect(frames.map((frame) => frame.done)).toEqual([false, false, true])
  })

  it("KF10: times applies to each key with one per stop, the rest evenly spaced", () => {
    const values = valuesAt(bag({ x: STOPS, y: [0, 100, 0, 100] }, { duration: 1, times: [0, 0.2, 1] }), [0.125])
    expect(values[0].x).toBeCloseTo(62.5, 9)
    expect(values[0].y).toBeCloseTo(37.5, 9)
  })

  it("KF11: keyframesValues through numbers is keyframes, looped, reversed, mirrored and flipped", () => {
    for (const options of [
      { ...EASES, repeat: 2, repeatType: "loop", repeatDelay: 0.2 },
      { ...EASES, repeat: 2, repeatType: "reverse", repeatDelay: 0.2 },
      { ...EASES, repeat: 2, repeatType: "mirror", repeatDelay: 0.2 },
      { ...EASES, repeat: 1, repeatType: "mirror", reverse: true },
    ] satisfies ReadonlyArray<Machine.KeyframesOptions>) {
      const one = valuesAt(Machine.keyframes(STOPS, options), REPEAT_AT)
      const many = valuesAt(bag({ x: STOPS }, options), REPEAT_AT).map((value) => value.x as number)
      closeTo(many, one, 9)
    }
  })

  it("KF12: one stop holds, none is left out, and a Discrete pair switches at its Segment's first Frame", () => {
    const values = valuesAt(bag({ x: [5], y: [], label: ["a", "b", "c"] }, { duration: 1 }), [0.03125, 0.25, 0.53125, 1])
    expect(values).toEqual([
      { x: 5, label: "b" },
      { x: 5, label: "b" },
      { x: 5, label: "c" },
      { x: 5, label: "c" },
    ])
  })

  it("KF13: delay holds once, before the first Segment, across the repeats", () => {
    const delayed = framesAt(Machine.keyframes(STOPS, { duration: 1, delay: 0.5, repeat: 1 }), [0.25, 0.75, 1.75, 2.5])
    const plain = framesAt(Machine.keyframes(STOPS, { duration: 1, repeat: 1 }), [0.25, 1.25, 2])
    expect(delayed.slice(1)).toEqual(plain)
  })
})
