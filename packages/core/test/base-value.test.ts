/**
 * Base values (#47, ADR-0022): a transform key's identity, and the chains a key with no
 * value starts from and returns to. Pure, so node-tier.
 *
 * Motion's rule for a transform key's default is `name.includes("scale") ? 1 : 0`
 * (motion-dom parse-transform.ts:62-64 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8); the
 * key set is the DOM renderer's transform keys (renderer.ts TRANSFORM_UNITS at 18b1e86).
 */
import { type BaseSources, baseValueOf, startValueOf, TRANSFORM_IDENTITY, transformIdentity } from "@wardic/core"
import * as Option from "effect/Option"
import { expect, it } from "@effect/vitest"

const SCALE_KEYS = ["scale", "scaleX", "scaleY"]
const ZERO_KEYS = ["x", "y", "z", "translateX", "translateY", "translateZ", "rotate", "rotateX", "rotateY", "rotateZ", "skewX", "skewY"]

/** A lookup that fails the test if the chain calls it. */
const never = (name: string) => (key: string): Option.Option<never> => {
  throw new Error(`${name}(${key}) was called after an earlier link hit`)
}

/** Sources with every link empty, for a case to override. */
const empty = (over: Partial<BaseSources> = {}): BaseSources => ({
  base: {},
  initial: {},
  style: () => Option.none(),
  own: () => Option.none(),
  ...over,
})

it("B1: TRANSFORM_IDENTITY holds exactly the transform keys, 1 for a scale and 0 otherwise, frozen", () => {
  expect(Object.keys(TRANSFORM_IDENTITY).sort()).toEqual([...SCALE_KEYS, ...ZERO_KEYS].sort())
  for (const key of SCALE_KEYS) expect(TRANSFORM_IDENTITY[key]).toBe(1)
  for (const key of ZERO_KEYS) expect(TRANSFORM_IDENTITY[key]).toBe(0)
  expect(Object.isFrozen(TRANSFORM_IDENTITY)).toBe(true)
})

it("B2: transformIdentity gives a transform key's identity", () => {
  for (const key of SCALE_KEYS) expect(transformIdentity(key)).toEqual(Option.some(1))
  for (const key of ZERO_KEYS) expect(transformIdentity(key)).toEqual(Option.some(0))
})

it("B3: transformIdentity has nothing for any other key, prototype names included", () => {
  for (const key of ["opacity", "width", "background-color", "--x", "attrScale", "cx", "toString", "__proto__", "constructor"]) {
    expect(transformIdentity(key)).toEqual(Option.none())
  }
})

it("B4: baseValueOf: the resolved base wins, and no later link is asked", () => {
  const r = baseValueOf("opacity", empty({ base: { opacity: 0.3 }, initial: { opacity: 0.1 }, style: never("style"), own: never("own") }))
  expect(r).toEqual(Option.some({ value: 0.3, source: "base" }))
})

it("B5: baseValueOf: then the key's initial value, without asking style or own", () => {
  const r = baseValueOf("scale", empty({ initial: { scale: 0.5 }, style: never("style"), own: never("own") }))
  expect(r).toEqual(Option.some({ value: 0.5, source: "initial" }))
})

it("B6: baseValueOf: then the element's style value, without asking own", () => {
  const r = baseValueOf("opacity", empty({ style: (k) => Option.filter(Option.some(0.5), () => k === "opacity"), own: never("own") }))
  expect(r).toEqual(Option.some({ value: 0.5, source: "style" }))
})

it("B7: baseValueOf: then the own value, last", () => {
  const r = baseValueOf("scale", empty({ own: (k) => transformIdentity(k) }))
  expect(r).toEqual(Option.some({ value: 1, source: "own" }))
})

it("B8: baseValueOf: no link has the key, so there is no return", () => {
  expect(baseValueOf("opacity", empty())).toEqual(Option.none())
})

it("B9: baseValueOf reads base and initial by own property only", () => {
  const inherited = Object.create({ opacity: 1 }) as Record<string, number>
  const r = baseValueOf("opacity", empty({ base: inherited, initial: inherited, style: () => Option.some(0.25) }))
  expect(r).toEqual(Option.some({ value: 0.25, source: "style" }))
})

it("B10: startValueOf: the style value first, then the own value", () => {
  expect(startValueOf("opacity", { style: () => Option.some(0.5), own: never("own") })).toEqual(
    Option.some({ value: 0.5, source: "style" }),
  )
  expect(startValueOf("opacity", { style: () => Option.none(), own: () => Option.some(0.7) })).toEqual(
    Option.some({ value: 0.7, source: "own" }),
  )
})

it("B11: startValueOf: neither link has the key, so the key starts at its target (the caller's last resort)", () => {
  expect(startValueOf("opacity", { style: () => Option.none(), own: () => Option.none() })).toEqual(Option.none())
})

it("B12: a zero or an empty string is a value, not a miss", () => {
  expect(baseValueOf("x", empty({ initial: { x: 0 }, style: never("style"), own: never("own") }))).toEqual(
    Option.some({ value: 0, source: "initial" }),
  )
  expect(baseValueOf("opacity", empty({ base: { opacity: 0 }, own: never("own") }))).toEqual(
    Option.some({ value: 0, source: "base" }),
  )
  expect(startValueOf("x", { style: () => Option.some(0), own: never("own") })).toEqual(
    Option.some({ value: 0, source: "style" }),
  )
})
