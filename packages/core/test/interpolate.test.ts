import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { expect, it, layer } from "@effect/vitest"

// Pure interpolator tests — no registry or Effect needed. Each entry is a codec and a blend
// (ADR-0026): `decodes` asks its codec, and `blendOf` decodes both endpoints, then blends.

/** Whether `entry`'s codec decodes `value`: whether the value is the entry's kind. */
const decodes = <D, E>(entry: Interpolator.Entry<D, E>, value: unknown): boolean =>
  Option.isSome(Schema.decodeUnknownOption(entry.codec)(value))

/** `entry`'s blend of two endpoints, decoded by its codec, at `t`. */
const blendOf =
  <D, E>(entry: Interpolator.Entry<D, E>, from: unknown, to: unknown) =>
  (t: number): E => {
    const decode = Schema.decodeUnknownSync(entry.codec)
    return Option.getOrThrow(entry.blend(decode(from), decode(to)))(t)
  }

it("number entry decodes numbers and lerps", () => {
  expect(decodes(Interpolator.number, 5)).toBe(true)
  expect(decodes(Interpolator.number, "5")).toBe(false)
  expect(blendOf(Interpolator.number, 0, 10)(0.5)).toBe(5)
})

it("array entry interpolates element-wise", () => {
  expect(decodes(Interpolator.array, [0, 0])).toBe(true)
  expect(blendOf(Interpolator.array, [0, 0], [10, 20])(0.5)).toEqual([5, 10])
})

// The array entry's blend runs per frame (#110): these pin what it gives, whatever its loop.
it("array entry lerps each element at any t, unclamped", () => {
  const blend = blendOf(Interpolator.array, [0, 10, -4], [10, 30, 4])
  expect([blend(0), blend(0.25), blend(1), blend(1.5), blend(-0.5)]).toEqual([
    [0, 10, -4],
    [2.5, 15, -2],
    [10, 30, 4],
    [15, 40, 8],
    [-5, 0, -8],
  ])
})

it("array entry, a `to` shorter than `from`: the elements past its end hold `from`'s", () => {
  const blend = blendOf(Interpolator.array, [0, 10, 20], [100])
  expect([blend(0), blend(0.5), blend(1)]).toEqual([
    [0, 10, 20],
    [50, 10, 20],
    [100, 10, 20],
  ])
})

it("array entry, a `to` longer than `from`: `from`'s length, the rest of `to` unread", () => {
  expect(blendOf(Interpolator.array, [0, 10], [10, 20, 30])(0.5)).toEqual([5, 15])
  expect(blendOf(Interpolator.array, [], [10, 20])(0.5)).toEqual([])
})

it("array entry returns a new array each frame, and leaves its endpoints as they were", () => {
  const from = [0, 10]
  const to = [10, 20]
  const blend = Option.getOrThrow(Interpolator.array.blend(from, to))
  const first = blend(0.5)
  const second = blend(1)
  expect(second).not.toBe(first)
  expect(first).toEqual([5, 15])
  expect(second).toEqual([10, 20])
  expect([from, to]).toEqual([
    [0, 10],
    [10, 20],
  ])
})

it("unit entry preserves the unit", () => {
  expect(decodes(Interpolator.unit, "10px")).toBe(true)
  expect(blendOf(Interpolator.unit, "0px", "10px")(0.5)).toBe("5px")
})

it("unitOf reads the unit the unit entry parses: '' for a bare number, None for none", () => {
  expect(Interpolator.unitOf(" 10px ")).toEqual(Option.some("px"))
  expect(Interpolator.unitOf("-100%")).toEqual(Option.some("%"))
  expect(Interpolator.unitOf("0.5em")).toEqual(Option.some("em"))
  expect(Interpolator.unitOf("120")).toEqual(Option.some(""))
  expect(Interpolator.unitOf("auto")).toEqual(Option.none())
  expect(Interpolator.unitOf("rgb(0, 0, 0)")).toEqual(Option.none())
})

// Registry-backed tests — all share InterpolatorRegistry.layer via layer().

layer(InterpolatorRegistry.layer)("interpolator registry", (it) => {
  it.effect("registry routes by value type", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      expect(yield* registry.interpolate(0, 10, 0.5)).toBe(5)
      expect(yield* registry.interpolate("0px", "10px", 0.5)).toBe("5px")
      expect(yield* registry.interpolate("M0,0 L10,10", "M0,0 L20,20", 0.5)).toBe("M0,0 L15,15")
    }),
  )

  it.effect("resolve returns a reusable (t) => T closure across multiple t values", () =>
    Effect.gen(function* () {
      // Arrange
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve(0, 100)

      // Act
      const atQuarter = fn(0.25)
      const atHalf = fn(0.5)
      const atFull = fn(1)

      // Assert
      expect(atQuarter).toBe(25)
      expect(atHalf).toBe(50)
      expect(atFull).toBe(100)
    }),
  )

  it.effect("resolve(0, '10px') picks the unit interpolator and yields '5px' at t=0.5", () =>
    Effect.gen(function* () {
      // Arrange
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve(0, "10px")

      // Act
      const mid = fn(0.5)

      // Assert
      expect(mid).toBe("5px")
    }),
  )

  it.effect("resolve('10px', '20em') is a Discrete pair, with a warning naming both values (ADR-0026)", () =>
    Effect.gen(function* () {
      // Arrange — capture the warning `resolve` logs for a pair an entry decodes but can't blend.
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const warnings: Array<{ readonly message: unknown; readonly annotations: Record<string, unknown> }> = []
      const capture = Logger.map(Logger.formatStructured, (structured) => {
        if (structured.level === "WARN") warnings.push({ message: structured.message, annotations: structured.annotations })
      })

      // Act
      const fn = yield* registry.resolve("10px", "20em").pipe(Effect.provide(Logger.layer([capture])))

      // Assert — it switches at the first frame past 0, and warns once, with both units in view.
      expect([fn(0), fn(0.01), fn(1)]).toEqual(["10px", "20em", "20em"])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.annotations).toMatchObject({ interpolator: "unit", from: "10px", to: "20em" })
    }),
  )

  it.effect("resolve('auto', 'left') is a Discrete pair: 'auto' at t=0, 'left' from the first frame past it (ADR-0024)", () =>
    Effect.gen(function* () {
      // Arrange
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("auto", "left")

      // Act
      const atStart = fn(0)
      const midway = fn(0.5)
      const atEnd = fn(1)

      // Assert
      expect(atStart).toBe("auto")
      expect(midway).toBe("left")
      expect(atEnd).toBe("left")
    }),
  )
})

// Isolated block — `register` mutates the shared registry, so this test gets
// its own `layer()` (a fresh InterpolatorRegistry.layer build) to keep the
// "always-999" override from leaking into the resolve(...) cases above.
layer(InterpolatorRegistry.layer)("interpolator registry (registration precedence)", (it) => {
  it.effect("registered interpolators take precedence over built-ins", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      yield* registry.register({
        name: "always-999",
        codec: Schema.Number,
        blend: () => Option.some(() => 999),
      })
      const result = yield* registry.interpolate(0, 10, 0.5)
      expect(result).toBe(999)
    }),
  )
})

// The registry keeps each pair of strings it resolves (ADR-0026, decision 9).
layer(InterpolatorRegistry.layer)("interpolator registry (the cache of string pairs)", (it) => {
  it.effect("a pair of strings resolves once: the same closure comes back", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const first = yield* registry.resolve("10px", "20px")
      const again = yield* registry.resolve("10px", "20px")
      expect(again).toBe(first)
      expect(again(0.5)).toBe("15px")
    }),
  )

  it.effect("numbers, and a number with a string, aren't kept", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      expect(yield* registry.resolve(0, 1)).not.toBe(yield* registry.resolve(0, 1))
      expect(yield* registry.resolve(0, "10px")).not.toBe(yield* registry.resolve(0, "10px"))
    }),
  )

  it.effect("a shared complex closure gives each caller its own frame, interleaved", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const a = yield* registry.resolve("M0,0 L10,10", "M0,0 L20,20")
      const b = yield* registry.resolve("M0,0 L10,10", "M0,0 L20,20")
      expect(b).toBe(a)
      expect([a(0.5), b(1), a(0)]).toEqual(["M0,0 L15,15", "M0,0 L20,20", "M0,0 L10,10"])
    }),
  )
})

it.effect("register empties the cache: a pair kept before it resolves through the new entry", () =>
  Effect.gen(function* () {
    const registry = yield* InterpolatorRegistry.make()
    expect((yield* registry.resolve("10px", "20px"))(0.5)).toBe("15px")
    yield* registry.register({
      name: "always-shout",
      codec: Schema.String,
      blend: () => Option.some(() => "SHOUT"),
    })
    expect((yield* registry.resolve("10px", "20px"))(0.5)).toBe("SHOUT")
  }),
)

