// The Default transition (#357, ADR-0051): what a key runs on when its transition isn't defined, the
// Environment's by key; and a defined transition as its legs run it, Motion's rules. Pure legs, as
// `retarget-legs.ssr.test.tsx` checks them, each leg's frames against core's machine on the
// transition it should run.
//
// - DT1: with the DOM's (Motion's table), a key with no transition runs on its value's: x and y on
//   one 500 / 25 spring, a scale on 550 / 30, opacity and a colour on one 0.3 s ease. Keys on one
//   Default transition share its legs.
// - DT2: a scale toward 0 is critically damped: it never dips below 0. Two scales, one toward 0, run
//   on two springs.
// - DT3: a transition that defines none: `{}`, the orchestration alone, a field set to `undefined`;
//   its `delay` holds each key's default, and its reduced-motion opt-out goes with it.
// - DT4: a value's entry (#301) leaves the keys without one on the own fields: defining none, each
//   runs on its default; `default` with a `delay` alone delays every key's.
// - DT5: no `type`: a spring field makes a spring (Motion's other fields filled in), anything else a
//   tween eased out; a repeat makes a tween too; `type: "tween"` wins over a spring field.
// - DT6: a typed transition takes Motion's fields for those it leaves out: a spring's 100 / 10 / 1,
//   which overshoots, and a tween's `easeOut`; a given easing stays.
// - DT7: an Environment with no opinion (core's `oneSpring`): every key on core's 170 / 26, numbers
//   and strings on two legs, as before #357.
// - DT8: a transition's run is worked out once per object; one that defines none has none.
// - DT9 (#359): a spring set by time: `bounce` or `visualDuration` with no `type` makes a spring, where
//   a `duration` alone stays a tween; with no stiffness, damping or mass it takes none of Motion's,
//   so core solves its physics; with one, Motion's fill the rest and win over its time.
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Values from "@wardic/core/Values"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as DomPositionalKeys from "@wardic/dom/DomPositionalKeys"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import type { WardicTransition } from "../src/config.ts"
import { type Leg, legsOf, NO_VELOCITY, runOf } from "../src/retarget-legs.ts"

const F = 1 / 60

/** The DOM's Default transition and Positional keys. */
const DOM: DefaultTransition.DefaultTransition["Service"] = { transitionFor: DomDefaultTransition.transitionFor, keyframes: DomDefaultTransition.keyframes }
const POSITIONAL: ReducedMotion.PositionalKeys["Service"] = { isPositional: DomPositionalKeys.isPositional }

/** Core's, for an Environment with no opinion. */
const ONE_SPRING = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* DefaultTransition.DefaultTransition }), DefaultTransition.oneSpring))

/** Motion's DOM defaults, as `default-transitions.ts` has them at 16c6122. */
const TRANSFORM = { stiffness: 500, damping: 25, restSpeed: 10 }
const SCALE = { stiffness: 550, damping: 30, restSpeed: 10 }
const EASE = { duration: 0.3, ease: Easing.cubicBezier(0.25, 0.1, 0.35, 1) }

const FROM: Values.Values = { x: 0, y: 0, scale: 1, opacity: 0, backgroundColor: "#000" }
const TO: Values.Values = { x: 100, y: 50, scale: 2, opacity: 1, backgroundColor: "#fff" }

/** A Retarget's legs from `from` to `to` on `transition`, under the DOM's defaults unless given others. */
const legsFor = (
  transition: WardicTransition | undefined,
  options: { readonly from?: Values.Values; readonly to?: Values.Values; readonly reduced?: boolean; readonly defaults?: DefaultTransition.DefaultTransition["Service"] } = {},
): ReadonlyArray<Leg> => {
  const { from = FROM, to = TO, reduced = false, defaults = DOM } = options
  return legsOf(from, to, transition, reduced, POSITIONAL, defaults, NO_VELOCITY)
}

/** Each leg's tag and keys. */
const shapeOf = (legs: ReadonlyArray<Leg>): ReadonlyArray<string> => legs.map((leg) => `${leg._tag} ${Object.keys(leg.to).join(",")}`)

type Run = Machine.Machine<Frame.Frame<unknown>>

/** A leg's machine, built (a Blend's with the DOM's Interpolators). */
const machineOf = (leg: Leg): Run => {
  if (leg._tag === "Blend") return Effect.runSync(Effect.provide(leg.machine(), DomInterpolators.layer))
  return leg.machine() as Run
}

/** A machine's values at 60 Hz until it settles (or 10 s), each a copy. */
const valuesOf = (machine: Run): ReadonlyArray<Record<string, unknown>> => {
  const step = machine.start()
  const out: Array<Record<string, unknown>> = []
  for (let i = 0; i < 600; i++) {
    const frame = step(F)
    out.push({ ...(frame.value as Record<string, unknown>) })
    if (frame.done) break
  }
  return out
}

/** Core's spring over `keys` from `FROM` to `TO` on `options`: what a Numbers leg on it runs. */
const springOver = (keys: ReadonlyArray<string>, options: Machine.SpringOptions): Run => {
  const pick = (values: Values.Values) => Object.fromEntries(keys.map((key) => [key, values[key] as number]))
  return Machine.springValues(pick(TO), options, pick(FROM)) as Run
}

/** Core's tween over `keys` from `FROM` to `TO` on `options`: what a Blend leg on it runs. */
const tweenOver = (keys: ReadonlyArray<string>, options: Machine.AnimateOptions): Run => {
  const pick = (values: Values.Values) => Object.fromEntries(keys.map((key) => [key, values[key] as number | string]))
  return Effect.runSync(Effect.provide(Machine.animateValues(pick(FROM), pick(TO), options), DomInterpolators.layer)) as Run
}

/** Whether a leg runs as `expected` does, frame for frame. */
const expectRunsAs = (leg: Leg, expected: Run, what: string): void => {
  expect(valuesOf(machineOf(leg)), what).toEqual(valuesOf(expected))
}

describe("the Default transition (#357, ADR-0051)", () => {
  it("DT1: with the DOM's, each key runs on its value's default, keys on one sharing its legs", () => {
    const legs = legsFor(undefined)
    expect(shapeOf(legs)).toEqual(["Numbers x,y", "Numbers scale", "Blend opacity,backgroundColor"])
    expectRunsAs(legs[0]!, springOver(["x", "y"], TRANSFORM), "x and y: Motion's 500 / 25 spring")
    expectRunsAs(legs[1]!, springOver(["scale"], SCALE), "scale: 550 / 30")
    expectRunsAs(legs[2]!, tweenOver(["opacity", "backgroundColor"], EASE), "opacity and a colour: the 0.3 s ease")
    // One Default transition for every key: no grouping, the legs it has alone.
    expect(shapeOf(legsFor(undefined, { from: { opacity: 0, backgroundColor: "#000" }, to: { opacity: 1, backgroundColor: "#fff" } }))).toEqual(["Blend opacity,backgroundColor"])
    expect(legsFor(undefined, { from: {}, to: {} }), "no key, no leg").toEqual([])
  })

  it("DT2: a scale toward 0 is critically damped, and two scales run on two springs", () => {
    const legs = legsFor(undefined, { from: { scaleX: 1, scaleY: 1 }, to: { scaleX: 0, scaleY: 2 } })
    expect(shapeOf(legs)).toEqual(["Numbers scaleX", "Numbers scaleY"])
    const toZero = valuesOf(machineOf(legs[0]!)).map((v) => v.scaleX as number)
    expect(Math.min(...toZero), "never past 0").toBeGreaterThanOrEqual(0)
    expect(toZero.at(-1)).toBe(0)
    const pick = { scaleX: 0 }
    expect(valuesOf(machineOf(legs[0]!))).toEqual(valuesOf(Machine.springValues(pick, { stiffness: 550, damping: 2 * Math.sqrt(550), restSpeed: 10 }, { scaleX: 1 }) as Run))
    // Toward anything else, 550 / 30 overshoots.
    const toTwo = valuesOf(machineOf(legs[1]!)).map((v) => v.scaleY as number)
    expect(Math.max(...toTwo), "past 2 on the way").toBeGreaterThan(2)
  })

  it("DT3: a transition that defines none leaves each key on its default, with its delay and its opt-out", () => {
    const none = valuesOf(machineOf(legsFor(undefined)[0]!))
    for (const transition of [{}, { staggerChildren: 0.1, when: "beforeChildren" }, { stiffness: undefined }] as ReadonlyArray<WardicTransition>) {
      const legs = legsFor(transition)
      expect(shapeOf(legs), JSON.stringify(transition)).toEqual(["Numbers x,y", "Numbers scale", "Blend opacity,backgroundColor"])
      expect(valuesOf(machineOf(legs[0]!)), JSON.stringify(transition)).toEqual(none)
    }
    // A delay holds each default: the spring's and the ease's.
    const delayed = legsFor({ delay: 0.2 })
    expectRunsAs(delayed[0]!, springOver(["x", "y"], { ...TRANSFORM, delay: 0.2 }), "x and y, held 0.2 s")
    expectRunsAs(delayed[2]!, tweenOver(["opacity", "backgroundColor"], { ...EASE, delay: 0.2 }), "the ease, held 0.2 s")
    // Under reduced motion, the positional keys snap; with the opt-out, they run on their default.
    expect(shapeOf(legsFor(undefined, { reduced: true }))).toEqual(["Snap x,y", "Snap scale", "Blend opacity,backgroundColor"])
    const optedOut = legsFor({ respectReducedMotion: false }, { reduced: true })
    expect(shapeOf(optedOut)).toEqual(["Numbers x,y", "Numbers scale", "Blend opacity,backgroundColor"])
    expectRunsAs(optedOut[0]!, springOver(["x", "y"], TRANSFORM), "x and y on their spring")
  })

  it("DT4: a key a value's entry (#301) leaves on own fields that define none runs on its default", () => {
    const legs = legsFor({ opacity: { type: "tween", duration: 1 } })
    // The own fields' keys first, each group on its default, then the entry's.
    expect(shapeOf(legs)).toEqual(["Numbers x,y", "Numbers scale", "Blend backgroundColor", "Blend opacity"])
    expectRunsAs(legs[0]!, springOver(["x", "y"], TRANSFORM), "x and y: their default")
    expectRunsAs(legs[2]!, tweenOver(["backgroundColor"], EASE), "the colour: its default")
    expectRunsAs(legs[3]!, tweenOver(["opacity"], { duration: 1, ease: Easing.easeOut }), "opacity: its entry, eased out")
    // `default` with a delay alone: every key on its own default, held.
    const held = legsFor({ default: { delay: 0.1 } })
    expect(shapeOf(held)).toEqual(["Numbers x,y", "Numbers scale", "Blend opacity,backgroundColor"])
    expectRunsAs(held[1]!, springOver(["scale"], { ...SCALE, delay: 0.1 }), "the scale, held 0.1 s")
  })

  it("DT5: no type: a spring field makes a spring, anything else a tween eased out", () => {
    // A tween's field: every key on one tween, Motion's easeOut.
    const tween = legsFor({ duration: 0.5 })
    expect(shapeOf(tween)).toEqual(["Blend x,y,scale,opacity,backgroundColor"])
    expectRunsAs(tween[0]!, tweenOver(["x", "y", "scale", "opacity", "backgroundColor"], { duration: 0.5, ease: Easing.easeOut }), "a 0.5 s tween, eased out")
    // A spring field: a spring with Motion's other fields, 10 and 1.
    const spring = legsFor({ stiffness: 300 })
    expect(shapeOf(spring)).toEqual(["Numbers x,y,scale,opacity", "Blend backgroundColor"])
    expectRunsAs(spring[0]!, springOver(["x", "y", "scale", "opacity"], { stiffness: 300, damping: 10, mass: 1 }), "300 / 10 / 1")
    // A repeat: a tween, 0.3 s, played twice, back to its start.
    const repeated = legsFor({ repeat: 1, repeatType: "reverse" }, { from: { x: 0 }, to: { x: 100 } })
    expect(shapeOf(repeated)).toEqual(["Blend x"])
    const xs = valuesOf(machineOf(repeated[0]!)).map((v) => v.x as number)
    expect(xs.length, "two 0.3 s runs").toBe(36)
    expect(xs.at(-1), "reversed, at its start").toBe(0)
    // `type: "tween"` wins over a spring field (a type error in a literal; a hoisted object gets past).
    const mixed = { type: "tween", stiffness: 300 } as const
    expect(shapeOf(legsFor(mixed as WardicTransition))).toEqual(["Blend x,y,scale,opacity,backgroundColor"])
  })

  it("DT6: a typed transition takes Motion's fields for those it leaves out", () => {
    const spring = legsFor({ type: "spring" }, { from: { x: 0 }, to: { x: 100 } })
    expectRunsAs(spring[0]!, Machine.springValues({ x: 100 }, { stiffness: 100, damping: 10, mass: 1 }, { x: 0 }) as Run, "100 / 10 / 1")
    expect(Math.max(...valuesOf(machineOf(spring[0]!)).map((v) => v.x as number)), "bouncy: past 100").toBeGreaterThan(110)
    const damped = legsFor({ type: "spring", damping: 26 }, { from: { x: 0 }, to: { x: 100 } })
    expectRunsAs(damped[0]!, Machine.springValues({ x: 100 }, { stiffness: 100, damping: 26, mass: 1 }, { x: 0 }) as Run, "its damping, Motion's stiffness")
    const tween = legsFor({ type: "tween" }, { from: { x: 0 }, to: { x: 100 } })
    expectRunsAs(tween[0]!, tweenOver(["x"], { ease: Easing.easeOut }), "0.3 s, eased out")
    const linear = legsFor({ type: "tween", ease: Easing.linear }, { from: { x: 0 }, to: { x: 100 } })
    expectRunsAs(linear[0]!, tweenOver(["x"], { ease: Easing.linear }), "its own easing")
  })

  it("DT7: an Environment with no opinion runs every key on core's spring, as before", () => {
    const legs = legsFor(undefined, { defaults: ONE_SPRING })
    expect(shapeOf(legs)).toEqual(["Numbers x,y,scale,opacity", "Blend backgroundColor"])
    expectRunsAs(legs[0]!, springOver(["x", "y", "scale", "opacity"], {}), "170 / 26 / 1")
  })

  it("DT8: a transition's run is worked out once per object; one that defines none has none", () => {
    const given: WardicTransition = { duration: 0.5 }
    expect(runOf(given)).toBe(runOf(given))
    expect(runOf(given)).toEqual({ type: "tween", duration: 0.5, ease: Easing.easeOut })
    expect(runOf(undefined)).toBeUndefined()
    expect(runOf({ delay: 0.2, respectReducedMotion: false })).toBeUndefined()
    expect(runOf({ type: "spring" })).toEqual({ type: "spring", stiffness: 100, damping: 10, mass: 1 })
  })

  it("DT9: a spring set by time takes no physics of Motion's; a bounce or a visual duration makes a spring (#359)", () => {
    const one = { from: { x: 0, backgroundColor: "#000" }, to: { x: 100, backgroundColor: "#fff" } }
    const pickX = (legs: ReadonlyArray<Leg>) => legs[0]!
    // No type: a bounce or a visual duration makes a spring, solved by core; a duration alone a tween.
    for (const transition of [{ bounce: 0.25 }, { duration: 0.5, bounce: 0.2 }, { visualDuration: 0.4 }, { visualDuration: 0.4, bounce: 0.5 }] as ReadonlyArray<WardicTransition>) {
      expect(runOf(transition), JSON.stringify(transition)).toEqual({ ...transition, type: "spring" })
      const legs = legsFor(transition, one)
      expect(shapeOf(legs), JSON.stringify(transition)).toEqual(["Numbers x", "Blend backgroundColor"])
      expectRunsAs(pickX(legs), Machine.springValues({ x: 100 }, transition as Machine.SpringOptions, { x: 0 }) as Run, JSON.stringify(transition))
    }
    expect(runOf({ duration: 0.5 })?.type).toBe("tween")
    // Typed: a duration alone is a duration spring, Motion's bounce of 0.3; it lands at 0.5 s.
    const timed = legsFor({ type: "spring", duration: 0.5 }, one)
    expect(runOf({ type: "spring", duration: 0.5 })).toEqual({ type: "spring", duration: 0.5 })
    const xs = valuesOf(machineOf(pickX(timed))).map((v) => v.x as number)
    expect(xs.length, "the first frame at 0.5 s or past (30 frames of 1/60 s sum a hair short)").toBe(31)
    expect(xs.at(-1)).toBe(100)
    expect(Math.max(...xs), "Motion's bounce of 0.3: past 100").toBeGreaterThan(100)
    // Its strings blend on the same spring, landing with it.
    expect(valuesOf(machineOf(timed[1]!)).length).toBe(31)
    // A physics field: Motion's fill the rest, and they win over its time.
    expect(runOf({ type: "spring", duration: 0.5, stiffness: 300 })).toEqual({ type: "spring", duration: 0.5, stiffness: 300, damping: 10, mass: 1 })
    expectRunsAs(pickX(legsFor({ bounce: 0.25, damping: 20 }, one)), Machine.springValues({ x: 100 }, { stiffness: 100, damping: 20, mass: 1 }, { x: 0 }) as Run, "100 / 20 / 1, its bounce ignored")
  })
})
