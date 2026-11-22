/**
 * The Default transition by key (#882, ADR-0073 *Amendment (#882)*, Q2): Motion's table by a key's
 * name (`getDefaultTransition`, motion-dom default-transitions.ts at 16c6122), core's since #882, so
 * an object's and a scene's keys run on what the DOM's do. Pure, so node-tier. The DOM's own test,
 * `dom/test/default-transition.node.test.ts`, pins the same table through `DomDefaultTransition`.
 */
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

it("DT1: a transform's is a 500 / 25 spring; a scale's 550, critically damped toward 0, else 30; any other key a 0.3 s ease", () => {
  for (const key of ["x", "y", "z", "rotate", "rotateY", "skewX"]) {
    expect(DefaultTransition.byKey(key, 2), key).toEqual({ type: "spring", stiffness: 500, damping: 25, restSpeed: 10 })
  }
  expect(DefaultTransition.byKey("scale", 1.2)).toEqual({ type: "spring", stiffness: 550, damping: 30, restSpeed: 10 })
  expect(DefaultTransition.byKey("scaleX", 0)).toEqual({ type: "spring", stiffness: 550, damping: 2 * Math.sqrt(550), restSpeed: 10 })
  // An object's own keys, a uniform's, a camera's: no transform's name, so the ease.
  for (const key of ["uProgress", "fov", "intensity", "value"]) {
    expect(DefaultTransition.byKey(key, 1), key).toEqual({ type: "tween", duration: 0.3, ease: [0.25, 0.1, 0.35, 1] })
  }
})

it("DT2: the same answer is the same object, so keys sharing one share a leg", () => {
  expect(DefaultTransition.byKey("x", 1)).toBe(DefaultTransition.byKey("rotateZ", -40))
  expect(DefaultTransition.byKey("uProgress", 1)).toBe(DefaultTransition.byKey("fov", 60))
})

it.effect("DT3: layerByKey provides byKey, and Motion's keyframes tween through more than two stops", () =>
  Effect.gen(function* () {
    const defaults = yield* DefaultTransition.DefaultTransition
    expect(defaults.transitionFor("x", 1)).toBe(DefaultTransition.byKey("x", 1))
    expect(defaults.keyframes).toBe(DefaultTransition.KEYFRAMES_TWEEN)
    expect(defaults.keyframes).toEqual({ type: "tween", duration: 0.8, ease: "easeOut" })
  }).pipe(Effect.provide(DefaultTransition.layerByKey)),
)
