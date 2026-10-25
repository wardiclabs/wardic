// The DOM Environment's Default transition (ADR-0051, #357): Motion's by value (`motion-dom`'s
// `default-transitions.ts`, `getDefaultTransition`, at 16c6122).
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Easing from "@wardic/core/Easing"
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
    expect(Easing.nameOf((ease as { readonly easing: Easing.Easing }).easing), key).toEqual(Easing.nameOf(Easing.cubicBezier(0.25, 0.1, 0.35, 1)))
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
  }).pipe(Effect.provide(DomDefaultTransition.layer)),
)

it.effect("DD4: core's oneSpring, an Environment with no opinion's: every key on core's spring", () =>
  Effect.gen(function* () {
    const defaults = yield* DefaultTransition.DefaultTransition
    expect(defaults.transitionFor("x", 1)).toBe(DefaultTransition.ONE_SPRING)
    expect(defaults.transitionFor("opacity", 0)).toEqual({ type: "spring" })
  }).pipe(Effect.provide(DefaultTransition.oneSpring)),
)
