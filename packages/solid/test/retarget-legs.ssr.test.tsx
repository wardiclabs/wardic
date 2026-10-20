// A Retarget's legs from one pure builder (#48, PR 2; ADR-0044 decision 8): which machines run, in
// which order, from where, with nothing of an element's. The spine runs them (every spine test pins
// that it still does as before); a server render's Appear animation samples them (PR 3). Pure, so
// it runs here, with no DOM.
//
// - RL1: a spring: its numbers in one leg carrying velocity, its strings in one blended leg.
// - RL2: a tween: every key in one blended leg.
// - RL3: reduced motion: the positional keys snap first; a transition can opt out.
// - RL4: a tween's snap lands where the tween ends: at `from` after an odd `repeat` that reverses.
// - RL5: a following return's leg comes after the snap and before the rest, reads its target, and
//   (a spring's) starts from its key's velocity.
// - RL6: nothing is built until a leg's machine is called: a transition core rejects throws there.
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Values from "@wardic/core/Values"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import type { WardicTransition } from "../src/config.ts"
import { type Follows, type Leg, legsOf } from "../src/retarget-legs.ts"

const positionalKeys = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* ReducedMotion.PositionalKeys }), ReducedMotion.transformsOnly))

/** A Retarget as the tests give it: the builder's arguments, by name. */
interface Retarget {
  readonly from: Values.Values
  readonly to: Values.Values
  readonly transition: WardicTransition | undefined
  readonly reducedMotion: boolean
  readonly velocities: Readonly<Record<string, number>>
  readonly follow?: Follows
}

/** The legs of a Retarget of `x`, `opacity` and a colour, with `over`'s changes. */
const legsFor = (over: Partial<Retarget>): ReadonlyArray<Leg> => {
  const r: Retarget = {
    from: { x: 0, opacity: 0, backgroundColor: "#000" },
    to: { x: 100, opacity: 1, backgroundColor: "#fff" },
    transition: undefined,
    reducedMotion: false,
    velocities: {},
    ...over,
  }
  return legsOf(r.from, r.to, r.transition, r.reducedMotion, positionalKeys, r.velocities, r.follow)
}

/** A leg's machine, built (a Blend's with the DOM's Interpolators). */
const machineOf = (leg: Leg): Machine.Machine<Frame.Frame<unknown>> => {
  if (leg._tag === "Blend") return Effect.runSync(Effect.provide(leg.machine(), DomInterpolators.layer))
  return leg.machine() as Machine.Machine<Frame.Frame<unknown>>
}

/** A machine run to its settled Frame in 1/60 s steps: the last Frame's value. */
const settled = (machine: Machine.Machine<Frame.Frame<unknown>>): unknown => {
  const step = machine.start()
  let frame = step(0)
  for (let i = 0; i < 6000 && !frame.done; i++) frame = step(1 / 60)
  return frame.value
}

describe("legsOf (#48, ADR-0044 decision 8)", () => {
  it("RL1: a spring: its numbers in one leg carrying velocity, its strings in one blended leg", () => {
    const legs = legsFor({ velocities: { x: 500 } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Numbers", "Blend"])
    const numbers = machineOf(legs[0]!) as Machine.Machine<Frame.MultiPhysics>
    const first = numbers.start()(1 / 60)
    expect(first.value.x, "started at 500 px/s").toBeGreaterThan(5)
    expect(settled(numbers)).toEqual({ x: 100, opacity: 1 })
    expect(settled(machineOf(legs[1]!))).toEqual({ backgroundColor: "rgb(255, 255, 255)" })
  })

  it("RL2: a tween: every key in one blended leg", () => {
    const legs = legsFor({ transition: { type: "tween", duration: 0.2 } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Blend"])
    expect(settled(machineOf(legs[0]!))).toEqual({ x: 100, opacity: 1, backgroundColor: "rgb(255, 255, 255)" })
  })

  it("RL3: reduced motion: the positional keys snap first; a transition can opt out", () => {
    const legs = legsFor({ reducedMotion: true, transition: { delay: 0.25 } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Snap", "Numbers", "Blend"])
    const snap = legs[0] as Extract<Leg, { _tag: "Snap" }>
    expect(snap.keys).toEqual(["x"])
    const step = machineOf(snap).start()
    expect(step(0.2).value, "held through the transition's delay").toEqual({ x: 0 })
    expect(step(0.1)).toEqual({ value: { x: 100 }, done: true })
    expect(settled(machineOf(legs[1]!))).toEqual({ opacity: 1 })
    expect(legsFor({ reducedMotion: true, transition: { respectReducedMotion: false } }).map((leg) => leg._tag)).toEqual(["Numbers", "Blend"])
  })

  it("RL4: a tween's snap lands where the tween ends: at from after an odd repeat that reverses", () => {
    const legs = legsFor({ to: { x: 100 }, from: { x: 0 }, reducedMotion: true, transition: { type: "tween", duration: 0.1, repeat: 1, repeatType: "reverse" } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Snap"])
    expect(settled(machineOf(legs[0]!))).toEqual({ x: 0 })
  })

  it("RL5: a following return's leg comes after the snap and before the rest, and reads its target", () => {
    let target = 40
    const reads: Array<string> = []
    const legs = legsFor({
      reducedMotion: true,
      follow: {
        keysOf: (rest) => Object.keys(rest).filter((key) => key === "opacity"),
        targetOf: (key) => {
          reads.push(key)
          return () => target
        },
      },
    })
    expect(legs.map((leg) => leg._tag)).toEqual(["Snap", "Follow", "Blend"])
    expect(reads).toEqual(["opacity"])
    const follow = legs[1] as Extract<Leg, { _tag: "Follow" }>
    expect(follow.key).toBe("opacity")
    target = 3
    expect(settled(follow.machine() as Machine.Machine<Frame.Frame<unknown>>)).toBeCloseTo(3, 1)
    // A spring's follow starts from its key's velocity now, as its Numbers leg would.
    const firstStep = (velocity: number): number => {
      const legs = legsFor({ velocities: { opacity: velocity }, follow: { keysOf: () => ["opacity"], targetOf: () => () => 1 } })
      const chase = legs.find((leg) => leg._tag === "Follow")!.machine() as Machine.Machine<Frame.Frame<number>>
      return chase.start()(1 / 60).value
    }
    expect(firstStep(30) - firstStep(0)).toBeGreaterThan(0.3)
  })

  it("RL6: nothing is built until a leg's machine is called: a transition core rejects throws there", () => {
    const legs = legsFor({ to: { x: 100 }, from: { x: 0 }, transition: { stiffness: -1 } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Numbers"])
    expect(() => legs[0]!.machine()).toThrow(/stiffness/)
  })
})

