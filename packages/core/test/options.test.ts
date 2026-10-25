// The option bags decoded through Schema (#66, ADR-0025 *Amendment (#66)*): each bag a user
// writes is a Schema's encoded side, decoded once a bag when an animation is built or started. Its
// defaults are filled in, and a value no animation can take throws a `SchemaError` naming the
// field: the validation table, row by row, through the public builders and resolvers.
import * as Easing from "@wardic/core/Easing"
import * as Machine from "@wardic/core/Machine"
import * as Spring from "@wardic/core/Spring"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { describe, expect, it } from "vitest"

type Row = readonly [field: string, bag: Record<string, unknown>]

/** A bag as a test's name: NaN and the infinities by name. */
const show = (bag: Record<string, unknown>): string =>
  JSON.stringify(bag, (_, v: unknown) =>
    Bool.match(Bool.and(Predicate.isNumber(v), !Number.isFinite(v as number)), { onTrue: () => String(v), onFalse: () => v }))

/** Each row's bag throws a `SchemaError` whose message names its field. */
const rejects = (build: (bag: never) => unknown, rows: ReadonlyArray<Row>): void => {
  for (const [field, bag] of rows) {
    it(`rejects ${show(bag)}`, () => {
      expect(() => build(bag as never)).toThrow(expect.objectContaining({ name: "SchemaError", message: expect.stringContaining(field) }))
    })
  }
}

/** Each bag builds. */
const accepts = (build: (bag: never) => unknown, bags: ReadonlyArray<Record<string, unknown>>): void => {
  it(`accepts ${bags.map(show).join(", ")}`, () => {
    for (const bag of bags) expect(() => build(bag as never)).not.toThrow()
  })
}

describe("SpringOptions: positive stiffness, mass and rest thresholds, non-negative damping and delay, finite", () => {
  rejects(Spring.resolve, [
    ["stiffness", { stiffness: 0 }],
    ["stiffness", { stiffness: -170 }],
    ["stiffness", { stiffness: Number.NaN }],
    ["stiffness", { stiffness: Number.POSITIVE_INFINITY }],
    ["stiffness", { stiffness: "170" }],
    ["damping", { damping: -1 }],
    ["damping", { damping: Number.NaN }],
    ["mass", { mass: 0 }],
    ["restDelta", { restDelta: 0 }],
    ["restSpeed", { restSpeed: 0 }],
    ["delay", { delay: -0.1 }],
    ["delay", { delay: Number.POSITIVE_INFINITY }],
    ["from", { from: Number.NaN }],
    ["velocity", { velocity: Number.NEGATIVE_INFINITY }],
  ])
  accepts(Spring.resolve, [{ damping: 0 }, { delay: 0 }, { from: -40, velocity: -900 }, { stiffness: undefined }])
  rejects((bag) => Machine.spring(1, bag), [["stiffness", { stiffness: 0 }]])
  rejects((bag) => Machine.springValues({ x: 1 }, bag), [["mass", { mass: -1 }]])
  rejects((bag) => Machine.chase(() => 1, bag), [["damping", { damping: -1 }]])

  it("fills in its defaults: 170 / 26 / 1, no delay, rest thresholds as given (else by distance, #344); `undefined` is missing", () => {
    const defaults = { stiffness: 170, damping: 26, mass: 1, restDelta: undefined, restSpeed: undefined, delay: 0 }
    expect(Spring.resolve({})).toEqual(defaults)
    // A JS caller's: `exactOptionalPropertyTypes` keeps it out of TypeScript.
    expect(Spring.resolve({ stiffness: undefined, delay: undefined } as unknown as Machine.SpringOptions)).toEqual(defaults)
    expect(Spring.resolve({ stiffness: 300, delay: 0.2 })).toEqual({ ...defaults, stiffness: 300, delay: 0.2 })
  })
})

describe("Easing.spring: its bag is a spring's, decoded when it's called (#225)", () => {
  rejects(Easing.spring, [
    ["mass", { mass: 0 }],
    ["stiffness", { stiffness: Number.NaN }],
    ["stiffness", { stiffness: "170" }],
    ["damping", { damping: -1 }],
    // A spring field the curve doesn't read is a spring's, so it's checked too.
    ["restDelta", { restDelta: 0 }],
    ["from", { from: Number.NaN }],
  ])
  accepts(Easing.spring, [{}, { stiffness: 300, damping: 10, mass: 2 }, { stiffness: 200, delay: 0.1, restDelta: 0.5, velocity: 40 }])

  it("called without a bag, it shares one: it decodes once, and never throws", () => {
    expect(() => Easing.spring()).not.toThrow()
  })
})

describe("TweenOptions: a non-negative, finite duration and delay, an Easing definition (#360)", () => {
  rejects(Machine.resolveTween, [
    ["duration", { duration: -1 }],
    ["duration", { duration: Number.NaN }],
    ["duration", { duration: Number.POSITIVE_INFINITY }],
    ["delay", { delay: -1 }],
    ["ease", { ease: "wobble" }],
    ["ease", { ease: [0.25, 0.1, 0.35] }],
    ["ease", { ease: [0.25, 0.1, Number.NaN, 1] }],
    // Wardic's old name, rejected naming the new one, so a hoisted bag can't lose its easing silently.
    ["`ease`", { easing: Easing.linear }],
  ])
  accepts(Machine.resolveTween, [{ ease: "easeOut" }, { ease: "anticipate" }, { ease: [0.25, 0.1, 0.35, 1] }, { ease: Easing.easeOutCubic }])
  rejects((bag) => Machine.tween(0, 1, bag), [["duration", { duration: -1 }]])
  rejects((bag) => Machine.keyframes([0, 1, 0], bag), [["delay", { delay: Number.NaN }]])

  it("fills in its defaults: 0.3 s, no delay, linear; a zero duration still divides, and keeps its 0", () => {
    expect(Machine.resolveTween({})).toEqual({ delay: 0, duration: 0.3, seconds: 0.3, ease: Easing.linear })
    expect(Machine.resolveTween({ duration: 0 })).toEqual({ delay: 0, duration: Number.EPSILON, seconds: 0, ease: Easing.linear })
  })
})

describe("AnimateOptions: a tween's fields, a whole number of repeats or Infinity, a non-negative repeatDelay", () => {
  rejects((bag) => Machine.animate(0, 1, bag), [
    ["repeat", { repeat: 1.5 }],
    ["repeat", { repeat: -1 }],
    ["repeat", { repeat: Number.NaN }],
    ["repeatDelay", { repeatDelay: -0.1 }],
    ["repeatType", { repeatType: "yoyo" }],
    ["duration", { duration: -1, repeat: 2 }],
  ])
  accepts((bag) => Machine.animate(0, 1, bag), [{ repeat: 0 }, { repeat: 3, repeatType: "reverse" }, { repeat: 3, repeatType: "mirror" }, { repeat: Number.POSITIVE_INFINITY }])
})

describe("DecayOptions: a positive friction and rest speed, a non-negative delay", () => {
  rejects((bag) => Machine.decay(0, 100, bag), [
    ["friction", { friction: 0 }],
    ["restSpeed", { restSpeed: 0 }],
    ["delay", { delay: -1 }],
  ])
  rejects((bag) => Machine.decayVec({ x: 0, y: 0 }, { x: 1, y: 1 }, bag), [["friction", { friction: Number.NaN }]])
})

describe("InertiaOptions: positive time constant, bounce stiffness and rest thresholds, edges in order", () => {
  // An inertia's glide is worked out from its start, so its bag is decoded there.
  rejects((bag) => Machine.inertia(0, 100, bag).start(), [
    ["timeConstant", { timeConstant: 0 }],
    ["bounceStiffness", { bounceStiffness: 0 }],
    ["bounceDamping", { bounceDamping: -1 }],
    ["restDelta", { restDelta: 0 }],
    ["restSpeed", { restSpeed: 0 }],
    ["power", { power: Number.NaN }],
    ["power", { power: Number.POSITIVE_INFINITY }],
    ["min", { min: Number.NaN }],
    ["max", { max: Number.NaN }],
    ["min (10) at or below max (0)", { min: 10, max: 0 }],
    ["modifyTarget", { modifyTarget: 5 }],
  ])
  accepts((bag) => Machine.inertia(0, 100, bag).start(), [
    { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY },
    { min: 0, max: 0 },
    { bounceDamping: 0 },
    { power: 0 },
  ])
  rejects((bag) => Machine.inertiaVec({ x: 0, y: 0 }, { x: 1, y: 1 }, bag).start(), [["timeConstant", { y: { timeConstant: -1 } }]])
})

describe("each bag is decoded once: its result cached by the bag's identity", () => {
  it("the same bag resolves to the same object; an equal bag decodes afresh", () => {
    const bag = { stiffness: 300 }
    expect(Spring.resolve(bag)).toBe(Spring.resolve(bag))
    expect(Spring.resolve({ stiffness: 300 })).not.toBe(Spring.resolve(bag))
    expect(Spring.resolve({ stiffness: 300 })).toEqual(Spring.resolve(bag))
    const tween = { duration: 0.4 }
    expect(Machine.resolveTween(tween)).toBe(Machine.resolveTween(tween))
  })

  it("a bag changed after its first decode keeps the first result (the bags are read once)", () => {
    const bag: { stiffness: number } = { stiffness: 300 }
    expect(Spring.resolve(bag).stiffness).toBe(300)
    bag.stiffness = 0
    expect(Spring.resolve(bag).stiffness).toBe(300)
  })

  it("a builder called without a bag shares one: it decodes once, and never throws", () => {
    expect(() => Machine.spring(1)).not.toThrow()
    expect(() => Machine.animate(0, 1)).not.toThrow()
    expect(() => Machine.inertia(0, 1).start()).not.toThrow()
  })
})
