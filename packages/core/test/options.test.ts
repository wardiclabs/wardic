// The option bags checked (#66, ADR-0025 *Amendment (#66)*; by hand since #511, *Amendment
// (#511)*): each bag a user writes is checked once a bag when an animation is built or started. Its
// defaults are filled in, and a value no animation can take throws an `OptionError` naming the
// field: the validation table, row by row, through the public builders and resolvers; and the
// messages, word for word as Schema's decode wrote them before #511.
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

/** Each row's bag throws an `OptionError` whose message names its field. */
const rejects = (build: (bag: never) => unknown, rows: ReadonlyArray<Row>): void => {
  for (const [field, bag] of rows) {
    it(`rejects ${show(bag)}`, () => {
      expect(() => build(bag as never)).toThrow(expect.objectContaining({ name: "OptionError", message: expect.stringContaining(field) }))
    })
  }
}

/** What `build` throws for `bag`. */
const thrownBy = (build: () => unknown): unknown => {
  try {
    build()
  } catch (error) {
    return error
  }
  return undefined
}

/** Each bag builds. */
const accepts = (build: (bag: never) => unknown, bags: ReadonlyArray<Record<string, unknown>>): void => {
  it(`accepts ${bags.map(show).join(", ")}`, () => {
    for (const bag of bags) expect(() => build(bag as never)).not.toThrow()
  })
}

describe("SpringOptions: positive stiffness, mass, rest thresholds and visual duration, non-negative damping, delay and duration, finite", () => {
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
    // A time-based spring's (#359): a duration Motion clamps from 0.01 s, any finite bounce.
    ["duration", { duration: -0.5 }],
    ["duration", { duration: Number.POSITIVE_INFINITY }],
    ["bounce", { bounce: Number.NaN }],
    ["visualDuration", { visualDuration: 0 }],
  ])
  accepts(Spring.resolve, [{ damping: 0 }, { delay: 0 }, { from: -40, velocity: -900 }, { stiffness: undefined }, { duration: 0 }, { bounce: 1.5 }, { bounce: -1, visualDuration: 0.3 }])
  rejects((bag) => Machine.spring(1, bag), [["stiffness", { stiffness: 0 }]])
  rejects((bag) => Machine.springValues({ x: 1 }, bag), [["mass", { mass: -1 }]])
  rejects((bag) => Machine.chase(() => 1, bag), [["damping", { damping: -1 }]])

  it("fills in its defaults: 170 / 26 / 1, no delay, rest thresholds as given (else by distance, #344); `undefined` is missing", () => {
    // Ends at rest: no duration (#359). With its step's matrix (#370), internal.
    const defaults = { stiffness: 170, damping: 26, mass: 1, restDelta: undefined, restSpeed: undefined, delay: 0, duration: Number.POSITIVE_INFINITY, exact: expect.any(Object) }
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
    // A Bézier's x outside 0 to 1, as CSS's cubic-bezier() rejects it (#618).
    ["ease", { ease: [2, 0, 1, 1] }],
    ["ease", { ease: [0.2, 0, -0.1, 1] }],
    // Wardic's old name, rejected naming the new one, so a hoisted bag can't lose its easing silently.
    ["`ease`", { easing: Easing.linear }],
  ])
  accepts(Machine.resolveTween, [
    { ease: "easeOut" },
    { ease: "anticipate" },
    { ease: [0.25, 0.1, 0.35, 1] },
    { ease: Easing.easeOutCubic },
    // A y beyond 0 to 1 overshoots, and the x's ends are in (#618).
    { ease: [0.3, 1.6, 0.6, 1] },
    { ease: [0, 0, 1, 1] },
  ])
  rejects((bag) => Machine.tween(0, 1, bag), [["duration", { duration: -1 }]])
  rejects((bag) => Machine.keyframes([0, 1, 0], bag), [
    ["delay", { delay: Number.NaN }],
    // Each stop's place (#429): from 0 to 1, in order; the repeat modifiers as animate's.
    ["times", { times: [0, 1.5, 1] }],
    ["times", { times: [0, 0.6, 0.4] }],
    ["times", { times: [0, Number.NaN, 1] }],
    ["repeat", { repeat: 1.5 }],
    ["repeatType", { repeatType: "bounce" }],
  ])
  accepts((bag) => Machine.keyframes([0, 1, 0], bag), [{ times: [0, 0.5, 0.5] }, { times: [0, 1] }, { repeat: Infinity, repeatType: "mirror" }])

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

/** Motion's easing names, as a rejected `ease` lists them. */
const NAMES = '"linear" | "easeIn" | "easeOut" | "easeInOut" | "circIn" | "circOut" | "circInOut" | "backIn" | "backOut" | "backInOut" | "anticipate"'

describe("OptionError's messages: Schema's, word for word (#511)", () => {
  // Each as Schema's decode wrote it before #511: `Expected …`, then the field's place; a union's
  // members that take the value, each on its lines; a place below the field; a value of the wrong
  // type as its type `| undefined`; the first rejected field in the bag's declared order.
  const cases: ReadonlyArray<readonly [name: string, build: () => unknown, message: string]> = [
    ["a stiffness at or below 0", () => Spring.resolve({ stiffness: -1 }), 'Expected a value greater than 0\n  at ["stiffness"]'],
    ["the first field rejected, in the declared order", () => Spring.resolve({ mass: 0, stiffness: -1 }), 'Expected a value greater than 0\n  at ["stiffness"]'],
    ["a negative damping", () => Spring.resolve({ damping: -1 }), 'Expected a value greater than or equal to 0\n  at ["damping"]'],
    ["NaN", () => Spring.resolve({ from: Number.NaN }), 'Expected a finite number\n  at ["from"]'],
    ["a JS caller's string", () => Spring.resolve({ stiffness: "170" } as never), 'Expected number | undefined\n  at ["stiffness"]'],
    ["a bag that isn't an object", () => Spring.resolve(5 as never), "Expected object"],
    ["a fractional repeat", () => Machine.animate(0, 1, { repeat: 1.5 }), 'Expected a whole number of repeats, 0 or above, or Infinity\n  at ["repeat"]'],
    ["an ease that's none of Motion's names", () => Machine.animate(0, 1, { ease: "bogus" as never }), `Expected ${NAMES}\n  at ["ease"]\nExpected an easing function\n  at ["ease"]`],
    ["a bézier of three numbers", () => Machine.resolveTween({ ease: [0.25, 0.1, 0.35] as never }), 'Missing key\n  at ["ease"][3]\nExpected an easing function\n  at ["ease"]'],
    ["a bézier of five numbers", () => Machine.resolveTween({ ease: [0.25, 0.1, 0.35, 1, 2] as never }), 'Expected no excess property\n  at ["ease"][4]\nExpected an easing function\n  at ["ease"]'],
    ["a bézier with a NaN", () => Machine.resolveTween({ ease: [0.25, 0.1, Number.NaN, 1] }), 'Expected a finite number\n  at ["ease"][2]\nExpected an easing function\n  at ["ease"]'],
    ["a bézier with an x outside 0 to 1", () => Machine.resolveTween({ ease: [2, 0, 1, 1] }), 'Expected a number from 0 to 1\n  at ["ease"][0]\nExpected an easing function\n  at ["ease"]'],
    ["Easing.cubicBezier with an x outside 0 to 1", () => Easing.cubicBezier(0.2, 0, 1.5, 1), "Expected a number from 0 to 1\n  at [2]"],
    // Values outside a bag, rejected as they're made, not at the first frame or never (#618).
    ["Easing.resolve with a name none of Motion's", () => Easing.resolve("bogus" as never), `Expected ${NAMES}`],
    ["Easing.steps with a NaN count", () => Easing.steps(Number.NaN), 'Expected a finite number\n  at ["count"]'],
    ["Easing.steps with no step", () => Easing.steps(0), 'Expected a count of 1 or more\n  at ["count"]'],
    ["Machine.delay by NaN", () => Machine.delay(Machine.tween(0, 1, {}), Number.NaN), 'Expected a finite number\n  at ["seconds"]'],
    ["Machine.delay by Infinity", () => Machine.delay(Machine.tween(0, 1, {}), Number.POSITIVE_INFINITY), 'Expected a finite number\n  at ["seconds"]'],
    ["an ease of the wrong type", () => Machine.resolveTween({ ease: 5 as never }), 'Expected an easing function\n  at ["ease"]'],
    ["a leftover `easing`", () => Machine.animate(0, 1, { easing: "linear" } as never), "Expected `ease`: Wardic's `easing` is `ease` now, as Motion's (#360)\n  at [\"easing\"]"],
    ["a repeatType that's none of three", () => Machine.animate(0, 1, { repeatType: "x" as never }), 'Expected "loop" | "reverse" | "mirror"\n  at ["repeatType"]'],
    ["a repeatType of the wrong type", () => Machine.animate(0, 1, { repeatType: 5 as never }), 'Expected "loop" | "reverse" | "mirror" | undefined\n  at ["repeatType"]'],
    ["a reverse that isn't a boolean", () => Machine.animate(0, 1, { reverse: 1 as never }), 'Expected boolean | undefined\n  at ["reverse"]'],
    ["min above max", () => Machine.inertia(0, 100, { min: 10, max: 0 }).start(), "Expected min (10) at or below max (0)"],
    ["an edge that's NaN", () => Machine.inertia(0, 100, { min: Number.NaN }).start(), 'Expected a number, not NaN\n  at ["min"]'],
    ["a modifyTarget that isn't a function", () => Machine.inertia(0, 100, { modifyTarget: 5 as never }).start(), 'Expected a modifyTarget function\n  at ["modifyTarget"]'],
    ["times out of order", () => Machine.keyframes([0, 1, 0], { times: [0, 0.6, 0.4] }), 'Expected times from 0 to 1, in order\n  at ["times"]'],
    ["a time that's NaN", () => Machine.keyframes([0, 1, 0], { times: [0, Number.NaN, 1] }), 'Expected a finite number\n  at ["times"][1]'],
    ["times that aren't an array", () => Machine.keyframes([0, 1, 0], { times: "x" as never }), 'Expected array | undefined\n  at ["times"]'],
    [
      "a list of eases, one none of Motion's names",
      () => Machine.keyframes([0, 1, 0], { ease: ["easeIn", "bogus" as never] }),
      `Expected number\n  at ["ease"][0]\nExpected an easing function\n  at ["ease"]\nExpected ${NAMES}\n  at ["ease"][1]\nExpected an easing function\n  at ["ease"][1]`,
    ],
    [
      "a list of eases holding a short bézier",
      () => Machine.keyframes([0, 1, 0], { ease: [[0, 0, 1] as never, "easeIn"] }),
      'Expected number\n  at ["ease"][0]\nExpected an easing function\n  at ["ease"]\nMissing key\n  at ["ease"][0][3]\nExpected an easing function\n  at ["ease"][0]',
    ],
    ["an empty list of eases", () => Machine.keyframes([0, 1, 0], { ease: [] as never }), 'Missing key\n  at ["ease"][0]\nExpected an easing function\n  at ["ease"]\nMissing key\n  at ["ease"][0]'],
  ]
  for (const [name, build, message] of cases) {
    it(name, () => {
      const error = thrownBy(build)
      expect(error).toBeInstanceOf(Machine.OptionError)
      expect(error).toBeInstanceOf(Error)
      expect(error).toEqual(expect.objectContaining({ _tag: "OptionError", name: "OptionError", message }))
    })
  }
})
