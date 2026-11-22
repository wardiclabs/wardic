/**
 * The unit scale (#883, ADR-0069 decision 8, ADR-0073 *Amendment (#883)*): an Environment's `x`, `y` and
 * `z` counted as that many of Motion's units, so a spring's rest thresholds fit its distances; and
 * `scaleZ`, core's third scale. Pure, so node-tier.
 */
import * as Batch from "@wardic/core/Batch"
import * as BaseValue from "@wardic/core/BaseValue"
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Spring from "@wardic/core/Spring"
import * as UnitScale from "@wardic/core/UnitScale"
import * as RetargetLegs from "@wardic/core/unstable/RetargetLegs"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

const SPRING = { stiffness: 100, damping: 10 } as const
const FRAME = 1 / 60

/** How far from its target a 5-unit move was on its last frame before it came to rest there: its snap. */
const snapOf = (step: (dt: number) => { readonly value: number; readonly done: boolean }): number => {
  let before = 0
  for (let i = 0; i < 2000; i++) {
    const frame = step(FRAME)
    if (frame.done) return Math.abs(5 - before)
    before = frame.value
  }
  throw new Error("never rested")
}

it.effect("US1: the unit scale is 1 unless the Environment's Layers give another; forKey counts x, y and z alone", () =>
  Effect.gen(function* () {
    expect(yield* UnitScale.UnitScale).toBe(1)
    expect(yield* UnitScale.UnitScale.pipe(Effect.provide(UnitScale.layer(100)))).toBe(100)
    expect([UnitScale.forKey(100, "x"), UnitScale.forKey(100, "z"), UnitScale.forKey(100, "rotateY"), UnitScale.forKey(100, "opacity")]).toEqual([100, 100, 1, 1])
  }),
)

it("US2: a scaled threshold is the old one at 1, a given one as it is, and by distance in Motion's units otherwise", () => {
  const spring = Spring.resolve(SPRING)
  expect(Spring.restDeltaIn(spring, 5, 1)).toBe(Spring.restDeltaFor(spring, 5))
  expect(Spring.restSpeedIn(spring, 5, 1)).toBe(Spring.restSpeedFor(spring, 5))
  expect(Spring.restDeltaIn(spring, 5, 100)).toBe(Spring.restDeltaFor(spring, 500, 100))
  const given = Spring.resolve({ ...SPRING, restDelta: 0.2, restSpeed: 3 })
  expect(Spring.restDeltaIn(given, 5, 100)).toBe(0.2)
  expect(Spring.restSpeedIn(given, 5, 100)).toBe(3)
})

it("US3: a 5 m move on springValues at a unit scale of 100 rests within millimetres, where Motion's thresholds snap it short", () => {
  const run = (unitScale?: number) => {
    const step = Machine.springValues({ x: 5 }, SPRING, { from: { x: 0 }, unitScale }).start()
    return snapOf((dt) => {
      const frame = step(dt)
      return { value: frame.value.x as number, done: frame.done }
    })
  }
  const motions = run()
  const metres = run(100)
  expect(motions).toBeGreaterThan(0.005)
  expect(metres).toBeLessThan(0.005)
})

it("US4: the spine's leg builder reads its keys at the unit scale it's given", () => {
  const legOf = (unitScale: number) => {
    const legs = RetargetLegs.legsOf({ x: 0 }, { x: 5 }, { type: "spring", ...SPRING }, false, false, { isPositional: ReducedMotion.isTransform }, { transitionFor: () => DefaultTransition.ONE_SPRING, keyframes: DefaultTransition.ONE_TWEEN }, () => 0, undefined, undefined, undefined, undefined, undefined, unitScale)
    const leg = legs[0]!
    // A numeric leg's machine is `springValues`' own.
    const machine = leg.machine() as unknown as Machine.Machine<{ readonly value: Readonly<Record<string, number>>; readonly done: boolean }>
    const step = machine.start()
    return snapOf((dt) => {
      const frame = step(dt)
      return { value: frame.value.x as number, done: frame.done }
    })
  }
  expect(legOf(1)).toBeGreaterThan(0.005)
  expect(legOf(100)).toBeLessThan(0.005)
})

it("US5: a Batch's member's key rests at its unit scale too", () => {
  const writer: Batch.Writer<{ x: number }> = { writes: () => true, forKeys: () => (subject, positions, base) => void (subject.x = positions[base]!) }
  const run = (unitScale?: number) => {
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring", ...SPRING }, unitScale })
    const dot = { x: 0 }
    const slot = Batch.enter(batch, dot, { x: 0 })
    Batch.play(Batch.animate(batch, [slot], () => 5, { head: Playback.make() }))
    // `step` says whether nothing moves now: at rest.
    return snapOf((dt) => {
      const resting = Batch.step(batch, dt)
      return { value: dot.x, done: resting }
    })
  }
  expect(run()).toBeGreaterThan(0.005)
  expect(run(100)).toBeLessThan(0.005)
})

it("US6: scaleZ is a transform key: its identity 1, positional, and a scale's spring by default", () => {
  expect(BaseValue.transformIdentity("scaleZ")).toEqual(Option.some(1))
  expect(ReducedMotion.isTransform("scaleZ")).toBe(true)
  expect(DefaultTransition.byKey("scaleZ", 0)).toBe(DefaultTransition.byKey("scale", 0))
  expect(DefaultTransition.byKey("scaleZ", 2)).toBe(DefaultTransition.byKey("scaleX", 2))
})
