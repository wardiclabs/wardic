// The DOM Environment's Default transition (ADR-0051, #357): Motion's by value (`motion-dom`'s
// `default-transitions.ts`, `getDefaultTransition`, at 16c6122).
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Machine from "@wardic/core/Machine"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

it("DD1: a transform's is a 500 / 25 spring; a scale's 550, critically damped toward 0, else 30; the rest a 0.3 s ease", () => {
  for (const key of ["x", "y", "z", "translateX", "rotate", "rotateY", "skewX"]) {
    expect(DomDefaultTransition.transitionFor(key, 100), key).toEqual({ type: "spring", stiffness: 500, damping: 25, restSpeed: 10 })
  }
  for (const key of ["scale", "scaleX", "scaleY"]) {
    expect(DomDefaultTransition.transitionFor(key, 2), key).toEqual({ type: "spring", stiffness: 550, damping: 30, restSpeed: 10 })
    expect(DomDefaultTransition.transitionFor(key, 0), `${key} toward 0`).toEqual({ type: "spring", stiffness: 550, damping: 2 * Math.sqrt(550), restSpeed: 10 })
  }
  for (const key of ["opacity", "backgroundColor", "background-color", "width", "filter", "--accent", "pathLength", "constructor"]) {
    const ease = DomDefaultTransition.transitionFor(key, 1)
    expect(ease, key).toMatchObject({ type: "tween", duration: 0.3 })
    expect((ease as { readonly ease: unknown }).ease, key).toEqual([0.25, 0.1, 0.35, 1])
  }
})

it("DD2: the same answer is the same object, so keys sharing one share a leg", () => {
  expect(DomDefaultTransition.transitionFor("x", 1)).toBe(DomDefaultTransition.transitionFor("rotate", -40))
  expect(DomDefaultTransition.transitionFor("scale", 0)).toBe(DomDefaultTransition.transitionFor("scaleY", 0))
  expect(DomDefaultTransition.transitionFor("opacity", 0)).toBe(DomDefaultTransition.transitionFor("color", "#fff"))
})

it.effect("DD3: the layer provides it as the Environment's DefaultTransition", () =>
  Effect.gen(function* () {
    const defaults = yield* DefaultTransition.DefaultTransition
    expect(defaults.transitionFor("x", 1)).toBe(DomDefaultTransition.transitionFor("x", 1))
    expect(defaults.keyframes).toBe(DomDefaultTransition.keyframes)
  }).pipe(Effect.provide(DomDefaultTransition.layer)),
)

it.effect("DD4: core's oneSpring, an Environment with no opinion's: every key on core's spring, keyframes on core's tween", () =>
  Effect.gen(function* () {
    const defaults = yield* DefaultTransition.DefaultTransition
    expect(defaults.transitionFor("x", 1)).toBe(DefaultTransition.ONE_SPRING)
    expect(defaults.transitionFor("opacity", 0)).toEqual({ type: "spring" })
    expect(defaults.keyframes).toBe(DefaultTransition.ONE_TWEEN)
  }).pipe(Effect.provide(DefaultTransition.oneSpring)),
)

it("DD5: more than two keyframes run on Motion's keyframesTransition: 0.8 s, each Segment on easeOut (#429)", () => {
  expect(DomDefaultTransition.keyframes).toEqual({ type: "tween", duration: 0.8, ease: "easeOut" })
  // motion-dom 14.6.0's JSAnimation on `{ keyframes: [0, 100, 40], duration: 800, ease: "easeOut" }`,
  // what `animateMotionValue` builds for three keyframes with no transition defined
  // (`.tmp/429/motion-ref.cjs`), to its bézier solver's 5.6e-4 (ME1).
  const motion = [46.151751762018456, 80.79780514132683, 77.3117121504934, 55.05303083953818]
  const step = Machine.keyframes([0, 100, 40], DomDefaultTransition.keyframes).start()
  let value = 0
  let elapsed = 0
  const at = [0.125, 0.25, 0.5, 0.625]
  at.forEach((t, i) => {
    while (elapsed < t) {
      value = step(1 / 32).value
      elapsed += 1 / 32
    }
    expect(value, `at ${t} s`).toBeCloseTo(motion[i], 1)
  })
})
