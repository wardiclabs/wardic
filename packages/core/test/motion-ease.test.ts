// Motion's `ease` (#360, ADR-0052): its named easings, an Easing definition (a name, a bézier's four
// numbers, a function) wherever an easing goes, and Wardic's old `easing` rejected naming `ease`.
//
// - ME1: Motion's named curves match Motion's own: framer-motion 13.4.0's, sampled at five points
//   (`easeIn`, `easeOut`, `easeInOut`, `circ*`, `back*`, `anticipate`, and a bézier from its numbers),
//   to 1e-3. Motion's bézier solver (a subdivision, 12 steps at most) is off the exact curve by up to
//   5.6e-4 at these points (backIn at 0.9); Wardic's (bezier-easing's Newton steps) is on it, checked against a
//   200-step bisection of the bézier.
// - ME2: a definition resolves: a name to its curve, four numbers to a named bézier, a function as it
//   is; each of Motion's curves is named for Appear.
// - ME3: a tween eases on each form.
// - ME4: a bag still giving `easing` is rejected, the message naming `ease`.
// - ME5: `keyframes` takes one `ease` per Segment, wrapping round when there are fewer, as Motion's;
//   four numbers there are one bézier, not four easings.
// - ME6: `interpolate` (createTransform's) eases each stretch: one definition for every stretch, or
//   one per stretch, linear past the list's end.
// - ME7: a stagger's `ease` takes a name.
import * as Easing from "@wardic/core/Easing"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as Machine from "@wardic/core/Machine"
import * as Stagger from "@wardic/core/Stagger"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"

const F = 1 / 60
const TS = [0.1, 0.25, 0.5, 0.75, 0.9] as const

/** framer-motion 13.4.0's easings at `TS` (React 19's harness, `motion-cmp/deps/ease-ref.mjs`). */
const MOTION: Readonly<Record<string, ReadonlyArray<number>>> = {
  easeIn: [0.0170417305, 0.0934037455, 0.3153766849, 0.6215864946, 0.8396101086],
  easeOut: [0.1603898914, 0.3784135054, 0.6846233151, 0.9065962545, 0.9829582695],
  easeInOut: [0.0196386432, 0.1289405261, 0.5, 0.8710594739, 0.9803613568],
  circIn: [0.0050125629, 0.0317541634, 0.1339745962, 0.3385621722, 0.5641101056],
  circOut: [0.4358898944, 0.6614378278, 0.8660254038, 0.9682458366, 0.9949874371],
  circInOut: [0.0101020514, 0.0669872981, 0.5, 0.9330127019, 0.9898979486],
  backIn: [-0.012172544, -0.0575488318, -0.0672571817, 0.2030772915, 0.5993094324],
  backOut: [0.4006905676, 0.7969227085, 1.0672571817, 1.0575488318, 1.012172544],
  backInOut: [-0.0209013136, -0.0336285908, 0.5, 1.0336285908, 1.0209013136],
  anticipate: [-0.0209013136, -0.0336285908, 0.5, 0.984375, 0.998046875],
}
/** framer-motion's `cubicBezier(0.25, 0.1, 0.35, 1)` at `TS`. */
const BEZIER = [0.0868497196, 0.3505861825, 0.7545872421, 0.9485668484, 0.9925413517]
/** The exact `cubic-bezier(0.42, 0, 1, 1)` and `cubic-bezier(0.25, 0.1, 0.35, 1)` at `TS`, by bisection. */
const EXACT_EASE_IN = [0.0170266097, 0.0934646507, 0.3153568126, 0.6218618692, 0.8394278458]
const EXACT_BEZIER = [0.0868804665, 0.3508050782, 0.7544322307, 0.9485010778, 0.992487392]

/** A machine's value after `seconds` of 1/60 s steps. */
const at = (machine: Machine.Machine<{ readonly value: number; readonly done: boolean }>, seconds: number): number => {
  const step = machine.start()
  let value = 0
  for (let i = 0; i < Math.round(seconds / F); i++) value = step(F).value
  return value
}

describe("Motion's ease (#360)", () => {
  it("ME1: Motion's named curves match Motion's own", () => {
    for (const [name, values] of Object.entries(MOTION)) {
      const curve = Easing.resolve(name as Easing.Name)
      for (const [i, t] of TS.entries()) expect(Math.abs(curve(t) - values[i]!), `${name}(${t})`).toBeLessThan(1e-3)
      expect(curve(0), `${name}(0)`).toBeCloseTo(0, 9)
      expect(curve(1), `${name}(1)`).toBeCloseTo(1, 9)
    }
    const bezier = Easing.resolve([0.25, 0.1, 0.35, 1])
    for (const [i, t] of TS.entries()) expect(Math.abs(bezier(t) - BEZIER[i]!), `bezier(${t})`).toBeLessThan(1e-3)
    // The exact curves, by a 200-step bisection: `easeIn` and the DOM's default ease.
    for (const [i, t] of TS.entries()) expect(Easing.easeIn(t), `exact easeIn(${t})`).toBeCloseTo(EXACT_EASE_IN[i]!, 7)
    for (const [i, t] of TS.entries()) expect(bezier(t), `exact bezier(${t})`).toBeCloseTo(EXACT_BEZIER[i]!, 7)
  })

  it("ME2: a definition resolves: a name to its curve, four numbers to a named bézier, a function as it is", () => {
    expect(Easing.resolve("easeOut")).toBe(Easing.easeOut)
    expect(Easing.resolve("linear")).toBe(Easing.linear)
    expect(Option.getOrUndefined(Easing.nameOf(Easing.resolve([0.4, 0, 0.1, 1])))).toBe("cubicBezier(0.4,0,0.1,1)")
    const mine = (t: number) => t * t
    expect(Easing.resolve(mine)).toBe(mine)
    for (const name of Easing.NAMES_LIST) expect(Option.getOrUndefined(Easing.nameOf(Easing.resolve(name))), name).toBe(name)
  })

  it("ME3: a tween eases on each form", () => {
    for (const ease of ["easeIn", [0.42, 0, 1, 1], Easing.easeIn] as ReadonlyArray<Easing.Definition>) {
      expect(at(Machine.tween(0, 100, { duration: 1, ease }), 0.5), JSON.stringify(ease)).toBeCloseTo(100 * Easing.easeIn(0.5), 6)
    }
  })

  it("ME4: a bag still giving easing is rejected, naming ease", () => {
    const bag = { duration: 1, easing: Easing.easeIn } as unknown as Machine.AnimateOptions
    expect(() => Machine.animate(0, 1, bag)).toThrow(expect.objectContaining({ name: "SchemaError", message: expect.stringContaining("Wardic's `easing` is `ease` now") }))
  })

  it("ME5: keyframes take one ease per Segment, wrapping round; four numbers are one bézier", () => {
    const stops = [0, 100, 0, 100]
    // Segments of 0.5 s: a quarter into each.
    const perSegment = Machine.keyframes(stops, { duration: 1.5, ease: ["easeIn", "easeOut"] })
    expect(at(perSegment, 0.25), "the first Segment, easeIn").toBeCloseTo(100 * Easing.easeIn(0.5), 4)
    expect(at(perSegment, 0.75), "the second, easeOut").toBeCloseTo(100 - 100 * Easing.easeOut(0.5), 4)
    expect(at(perSegment, 1.25), "the third wraps round to easeIn").toBeCloseTo(100 * Easing.easeIn(0.5), 4)
    const bezier = Machine.keyframes(stops, { duration: 1.5, ease: [0.42, 0, 1, 1] })
    expect(at(bezier, 0.75), "one bézier for every Segment").toBeCloseTo(100 - 100 * Easing.easeIn(0.5), 4)
  })

  it("ME6: interpolate eases each stretch: one for every stretch, or one per stretch, linear past the list", () => {
    const map = (options: LiveValue.TransformOptions) =>
      Effect.runSync(Effect.provide(LiveValue.interpolate([0, 1, 2], [0, 100, 200], options), InterpolatorRegistry.layer))
    const every = map({ ease: "easeIn" })
    expect(every(0.5)).toBeCloseTo(100 * Easing.easeIn(0.5), 6)
    expect(every(1.5)).toBeCloseTo(100 + 100 * Easing.easeIn(0.5), 6)
    const each = map({ ease: ["easeOut"] })
    expect(each(0.5), "its own").toBeCloseTo(100 * Easing.easeOut(0.5), 6)
    expect(each(1.5), "past the list: linear").toBeCloseTo(150, 6)
    expect(map({})(0.5), "none: linear").toBeCloseTo(50, 6)
  })

  it("ME7: a stagger's ease takes a name", () => {
    const delay = Stagger.make(0.1, { ease: "easeIn" })
    expect(delay(2, 5)).toBeCloseTo(0.1 * Easing.easeIn(0.5) * 4, 9)
  })
})
