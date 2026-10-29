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
//
// Per-value transitions (#301, Motion's `getValueTransition`):
// - PV1: a value's entry drives that value; the rest run on the transition's own fields.
// - PV2: `default` drives every value without an entry, not the own fields; an entry can be a spring
//   in a tween.
// - PV3: `inherit: true` lays an entry over the own fields; without it the entry stands alone.
// - PV4: one transition object resolves to the same transitions every Retarget; `layout` and
//   `default` alone put every value on one transition; no entries, the transition itself.
// - PV5: a stagger's delay goes on the own fields and on each entry; an `inherit` entry with no
//   delay of its own takes the own fields'.
// - PV6: the reduced-motion opt-out is the whole transition's; an entry can set its own.
// - PV7: a stagger's transition, made anew each Retarget with its entries, is reused while their
//   fields are the same (#66's decode cache keys on the object).
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Values from "@wardic/core/Values"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import type { WardicTransition } from "../src/config.ts"
import { delayedBy, type Follows, type Leg, legsOf, transitionForKey, velocitiesOf } from "../src/retarget-legs.ts"
import { makeReuse } from "../src/spine.ts"

const positionalKeys = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* ReducedMotion.PositionalKeys }), ReducedMotion.transformsOnly))

/** The Test Environment's Default transition: every key on one spring, core's (ADR-0051). */
const defaults = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* DefaultTransition.DefaultTransition }), DefaultTransition.oneSpring))

/** A Retarget as the tests give it: the builder's arguments, by name. */
interface Retarget {
  readonly from: Values.Values
  readonly to: Values.Values
  readonly transition: WardicTransition | undefined
  readonly reducedMotion: boolean
  readonly skipped?: boolean
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
  return legsOf(r.from, r.to, r.transition, r.reducedMotion, r.skipped === true, positionalKeys, defaults, velocitiesOf(r.velocities), r.follow)
}

/** A leg's machine, built (a Blend's with the DOM's Interpolators). */
const machineOf = (leg: Leg): Machine.Machine<Frame.Frame<unknown>> => {
  if (leg._tag === "Blend") return Effect.runSync(Effect.provide(leg.machine(), DomInterpolators.layer))
  return leg.machine() as Machine.Machine<Frame.Frame<unknown>>
}

/** How long a machine runs before it settles, in 1/60 s steps, s. */
const secondsOf = (machine: Machine.Machine<Frame.Frame<unknown>>): number => {
  const step = machine.start()
  let frame = step(0)
  let i = 0
  for (; i < 6000 && !frame.done; i++) frame = step(1 / 60)
  return i / 60
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

describe("per-value transitions (#301, Motion's getValueTransition)", () => {
  it("PV1: a value's entry drives that value; the rest run on the transition's own fields", () => {
    const legs = legsFor({ transition: { type: "tween", duration: 0.6, opacity: { type: "tween", duration: 0.2 } } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Blend", "Blend"])
    expect(settled(machineOf(legs[0]!))).toEqual({ x: 100, backgroundColor: "rgb(255, 255, 255)" })
    expect(secondsOf(machineOf(legs[0]!)), "the own fields' 0.6 s").toBeCloseTo(0.6, 1)
    expect(settled(machineOf(legs[1]!))).toEqual({ opacity: 1 })
    expect(secondsOf(machineOf(legs[1]!)), "its entry's 0.2 s").toBeCloseTo(0.2, 1)
  })

  it("PV2: default drives every value without an entry, not the own fields; an entry can be a spring", () => {
    const legs = legsFor({ transition: { type: "tween", duration: 1, default: { type: "tween", duration: 0.2 }, x: { type: "tween", duration: 0.4 } } })
    expect(legs.map((leg) => leg._tag)).toEqual(["Blend", "Blend"])
    expect(settled(machineOf(legs[0]!))).toEqual({ x: 100 })
    expect(secondsOf(machineOf(legs[0]!)), "x's entry").toBeCloseTo(0.4, 1)
    expect(settled(machineOf(legs[1]!))).toEqual({ opacity: 1, backgroundColor: "rgb(255, 255, 255)" })
    expect(secondsOf(machineOf(legs[1]!)), "default, not the own 1 s").toBeCloseTo(0.2, 1)
    const sprung = legsFor({ velocities: { x: 500 }, transition: { type: "tween", duration: 0.2, x: { stiffness: 300, damping: 30 } } })
    expect(sprung.map((leg) => leg._tag)).toEqual(["Numbers", "Blend"])
    const first = (machineOf(sprung[0]!) as Machine.Machine<Frame.MultiPhysics>).start()(1 / 60)
    expect(Object.keys(first.value)).toEqual(["x"])
    expect(first.value.x, "a spring, starting at its velocity").toBeGreaterThan(5)
  })

  it("PV3: inherit lays an entry over the own fields; without it the entry stands alone", () => {
    const legs = legsFor({
      to: { x: 100, opacity: 1 },
      transition: { type: "tween", duration: 0.6, delay: 0.1, opacity: { inherit: true, duration: 0.2 }, x: { type: "tween", duration: 0.2 } },
    })
    expect(legs.map((leg) => leg._tag)).toEqual(["Blend", "Blend"])
    expect(settled(machineOf(legs[0]!))).toEqual({ x: 100 })
    expect(secondsOf(machineOf(legs[0]!)), "x: its own 0.2 s, no delay").toBeCloseTo(0.2, 1)
    expect(settled(machineOf(legs[1]!))).toEqual({ opacity: 1 })
    expect(secondsOf(machineOf(legs[1]!)), "opacity: the own tween's delay, then its 0.2 s").toBeCloseTo(0.3, 1)
  })

  it("PV4: one transition object, the same transitions every Retarget; layout and default alone, one transition", () => {
    const transition: WardicTransition = { type: "tween", duration: 0.4, opacity: { type: "tween", duration: 0.2 }, default: { delay: 0.1 } }
    expect(transitionForKey(transition, "opacity")).toBe(transitionForKey(transition, "opacity"))
    expect(transitionForKey(transition, "x")).toBe(transitionForKey(transition, "y"))
    expect(transitionForKey(transition, "x")).toEqual({ delay: 0.1 })
    const plain: WardicTransition = { type: "tween", duration: 0.2 }
    expect(transitionForKey(plain, "opacity")).toBe(plain)
    expect(transitionForKey(undefined, "opacity")).toBeUndefined()
    const layoutOnly = legsFor({ transition: { type: "tween", duration: 0.2, layout: { type: "tween", duration: 1 } } })
    expect(layoutOnly.map((leg) => leg._tag)).toEqual(["Blend"])
    expect(secondsOf(machineOf(layoutOnly[0]!)), "every value on the own fields").toBeCloseTo(0.2, 1)
    const defaultOnly = legsFor({ transition: { type: "tween", duration: 1, default: { type: "tween", duration: 0.3 } } })
    expect(defaultOnly.map((leg) => leg._tag)).toEqual(["Blend"])
    expect(settled(machineOf(defaultOnly[0]!))).toEqual({ x: 100, opacity: 1, backgroundColor: "rgb(255, 255, 255)" })
    expect(secondsOf(machineOf(defaultOnly[0]!)), "every value on default").toBeCloseTo(0.3, 1)
  })

  it("PV5: a stagger's delay goes on the own fields and each entry; an inherit entry with no delay takes the own fields'", () => {
    const transition: WardicTransition = {
      type: "tween",
      delay: 0.1,
      default: { type: "tween", duration: 0.2 },
      opacity: { type: "tween", delay: 0.05 },
      x: { inherit: true },
      y: { inherit: true, delay: 0.3 },
    }
    expect(delayedBy(transition, 0)).toBe(transition)
    const later = delayedBy(transition, 0.5)!
    const delayOf = (key: string): number | undefined => transitionForKey(later, key)!.delay
    expect(later.delay, "its own").toBeCloseTo(0.6, 9)
    expect(delayOf("backgroundColor"), "default's").toBeCloseTo(0.5, 9)
    expect(delayOf("opacity"), "an entry's").toBeCloseTo(0.55, 9)
    expect(delayOf("x"), "inherit with none: the own fields'").toBeCloseTo(0.6, 9)
    expect(delayOf("y"), "inherit with its own").toBeCloseTo(0.8, 9)
    expect(delayedBy(undefined, 0.5)).toEqual({ delay: 0.5 })
  })

  it("PV6: the reduced-motion opt-out is the whole transition's; an entry can set its own", () => {
    const opted = legsFor({ reducedMotion: true, transition: { respectReducedMotion: false, x: { type: "tween", duration: 0.2 } } })
    expect(opted.map((leg) => leg._tag), "x's entry takes the opt-out").toEqual(["Blend", "Numbers", "Blend"])
    const own = legsFor({ reducedMotion: true, transition: { respectReducedMotion: false, x: { type: "tween", duration: 0.2, respectReducedMotion: true } } })
    expect(own.map((leg) => leg._tag), "x's own opt-in snaps it").toEqual(["Snap", "Numbers", "Blend"])
    const inherited = legsFor({ reducedMotion: true, transition: { x: { type: "tween", duration: 0.2 } } })
    expect(inherited.map((leg) => leg._tag), "honoured by default").toEqual(["Snap", "Numbers", "Blend"])
  })

  it("PV7: a stagger's transition, made anew with its entries, is reused while their fields are the same", () => {
    const element: WardicTransition = { type: "tween", duration: 0.4, opacity: { type: "tween", duration: 0.2 } }
    const reuse = makeReuse()
    const first = reuse(delayedBy(element, 0.1)!)
    expect(reuse(delayedBy(element, 0.1)!), "the same fields: the first object").toBe(first)
    expect(reuse(delayedBy(element, 0.2)!), "another delay: a new one").not.toBe(first)
  })
})

describe("a Skipped animation's legs (#468)", () => {
  /** Where each leg lands on its first tick, and whether it's done then. */
  const firstTick = (legs: ReadonlyArray<Leg>) => legs.map((leg) => machineOf(leg).start()(1 / 60))

  it("SL1: skipped, every key snaps to its target on its first tick, delay or reduced-motion opt-out or not", () => {
    for (const transition of [undefined, { type: "tween", duration: 2, delay: 1 }, { type: "spring", stiffness: 50, respectReducedMotion: false }] as const) {
      const legs = legsFor({ skipped: true, transition })
      expect(legs.map((leg) => leg._tag), JSON.stringify(transition)).toEqual(["Snap"])
      expect(firstTick(legs), JSON.stringify(transition)).toEqual([{ value: { x: 100, opacity: 1, backgroundColor: "#fff" }, done: true }])
    }
  })

  it("SL2: a transition's skipAnimations skips its keys, an entry's its own, and false undoes nothing", () => {
    expect(legsFor({ transition: { type: "tween", duration: 2, skipAnimations: true } }).map((leg) => leg._tag), "the whole transition's").toEqual(["Snap"])
    expect(legsFor({ transition: { skipAnimations: true } }).map((leg) => leg._tag), "on the Default transition").toEqual(["Snap"])
    const whole = legsFor({ transition: { type: "tween", duration: 2, skipAnimations: true, x: { type: "spring" } } })
    expect(whole.map((leg) => leg._tag), "an entry takes the whole transition's").toEqual(["Snap", "Snap"])
    const own = legsFor({ transition: { type: "tween", duration: 2, x: { type: "tween", duration: 2, skipAnimations: true } } })
    expect(own.map((leg) => leg._tag), "an entry's own, its key alone").toEqual(["Snap", "Blend"])
    expect(legsFor({ skipped: true, transition: { skipAnimations: false } }).map((leg) => leg._tag), "false doesn't undo a config's").toEqual(["Snap"])
  })

  it("SL3: a turned repeat lands where it would end", () => {
    const legs = legsFor({ skipped: true, transition: { type: "tween", duration: 1, repeat: 1, repeatType: "reverse" } })
    expect(firstTick(legs), "back at its start").toEqual([{ value: { x: 0, opacity: 0, backgroundColor: "#000" }, done: true }])
  })
})

