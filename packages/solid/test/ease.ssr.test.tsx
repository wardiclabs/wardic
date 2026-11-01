// Motion's `ease` in the Solid binding (#360, ADR-0052): a value transition's `ease` in each of its
// forms, a leftover `easing` failing its leg, Motion's easing functions re-exported, and a server's
// Appear rule on a named ease. Pure legs, as `retarget-legs.ssr.test.tsx` checks them.
//
// - EA1: a tween's `ease` as a name, a bézier's four numbers or a function runs that curve; with no
//   `type`, an `ease` makes a tween (ADR-0051), on its own `ease`, not the `easeOut` filled in.
// - EA2: a transition still giving `easing` fails its leg when the leg's machine is built, the message
//   naming `ease`.
// - EA3: `@wardic/solid` exports Motion's easing functions by Motion's names: core's own.
// - EA4: a server's Appear rule plays a named `ease` (its key names it), on the curve.
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Solid from "@wardic/solid"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import type { WardicTransition } from "../src/config.ts"
import { type Leg, legsOf, NO_VELOCITY } from "../src/retarget-legs.ts"

const F = 1 / 60
const POSITIONAL: ReducedMotion.PositionalKeys["Service"] = { isPositional: ReducedMotion.isTransform }
const ONE_SPRING: DefaultTransition.DefaultTransition["Service"] = { transitionFor: () => DefaultTransition.ONE_SPRING, keyframes: DefaultTransition.ONE_TWEEN }

/** The legs of an x and an opacity going 0 → 100 / 0 → 1 on `transition`. */
const legsFor = (transition: WardicTransition): ReadonlyArray<Leg> => legsOf({ x: 0, opacity: 0 }, { x: 100, opacity: 1 }, transition, false, false, POSITIONAL, ONE_SPRING, NO_VELOCITY)

/** A Blend leg's machine, built with the DOM's Interpolators. */
const machineOf = (leg: Leg): Machine.Machine<Frame.Frame<Record<string, unknown>>> => {
  if (leg._tag === "Blend") return Effect.runSync(Effect.provide(leg.machine(), DomInterpolators.layer)) as Machine.Machine<Frame.Frame<Record<string, unknown>>>
  return leg.machine() as Machine.Machine<Frame.Frame<Record<string, unknown>>>
}

/** A machine's x after `seconds` of 1/60 s steps. */
const xAt = (machine: Machine.Machine<Frame.Frame<Record<string, unknown>>>, seconds: number): number => {
  const step = machine.start()
  let x = 0
  for (let i = 0; i < Math.round(seconds / F); i++) x = step(F).value.x as number
  return x
}

describe("Motion's ease in the binding (#360)", () => {
  it("EA1: a tween's ease as a name, four numbers or a function runs that curve; with no type, it makes a tween on its own ease", () => {
    for (const ease of ["easeIn", [0.42, 0, 1, 1], Easing.easeIn] as ReadonlyArray<Easing.Definition>) {
      for (const transition of [{ type: "tween", duration: 1, ease }, { duration: 1, ease }] as ReadonlyArray<WardicTransition>) {
        const legs = legsFor(transition)
        expect(legs.map((leg) => leg._tag), JSON.stringify(transition)).toEqual(["Blend"])
        expect(xAt(machineOf(legs[0]!), 0.5), JSON.stringify(transition)).toBeCloseTo(100 * Easing.easeIn(0.5), 4)
      }
    }
  })

  it("EA2: a transition still giving easing fails its leg, naming ease", () => {
    const hoisted = { type: "tween", duration: 1, easing: Easing.easeIn } as const
    const legs = legsFor(hoisted as unknown as WardicTransition)
    expect(() => machineOf(legs[0]!)).toThrow(expect.objectContaining({ name: "OptionError", message: expect.stringContaining("Wardic's `easing` is `ease` now") }))
  })

  it("EA3: @wardic/solid exports Motion's easing functions, core's own", () => {
    for (const name of ["easeIn", "easeOut", "easeInOut", "circIn", "circOut", "circInOut", "backIn", "backOut", "backInOut", "anticipate", "cubicBezier", "steps"] as const) {
      expect(Solid[name], name).toBe(Easing[name])
    }
  })
})
