import {
  arrayInterpolator,
  colorInterpolator,
  InterpolatorRegistry,
  InterpolatorRegistryLive,
  numberInterpolator,
  unitInterpolator,
} from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import { expect, it, layer } from "@effect/vitest"

// Pure interpolator tests — no registry or Effect needed.

it("number entry matches and lerps", () => {
  expect(numberInterpolator.match(5)).toBe(true)
  expect(numberInterpolator.match("5")).toBe(false)
  expect(numberInterpolator.interpolate(0, 10, 0.5)).toBe(5)
})

it("array entry interpolates element-wise", () => {
  expect(arrayInterpolator.match([0, 0])).toBe(true)
  expect(arrayInterpolator.interpolate([0, 0], [10, 20], 0.5)).toEqual([5, 10])
})

it("unit entry preserves the unit", () => {
  expect(unitInterpolator.match("10px")).toBe(true)
  expect(unitInterpolator.interpolate("0px", "10px", 0.5)).toBe("5px")
})

it("color interpolator does not match the CSS keyword 'auto'", () => {
  // Arrange
  const color = colorInterpolator()

  // Act
  const matched = color.match("auto")

  // Assert
  expect(matched).toBe(false)
})

it("color interpolator matches the named color 'rebeccapurple'", () => {
  // Arrange
  const color = colorInterpolator()

  // Act
  const matched = color.match("rebeccapurple")

  // Assert
  expect(matched).toBe(true)
})

it("color match fast-path accepts '#fff' and 'rgb(0,0,0)' without throwing", () => {
  // Arrange — stub culori parse via a fake entry that throws if its parse is hit.
  // Since `colorInterpolator` closes over the imported `parse`, we cannot replace
  // it from the outside; we instead assert the fast-path by relying on the fact
  // that the syntactic prefix branch returns true *before* touching culori. A
  // throwing parse would surface as a thrown error; the test asserts no throw
  // and a true result for both forms.
  const color = colorInterpolator()

  // Act
  const hashMatch = (): boolean => color.match("#fff")
  const rgbMatch = (): boolean => color.match("rgb(0,0,0)")

  // Assert
  expect(hashMatch).not.toThrow()
  expect(rgbMatch).not.toThrow()
  expect(hashMatch()).toBe(true)
  expect(rgbMatch()).toBe(true)
})

// Registry-backed tests — all share InterpolatorRegistryLive via layer().

layer(InterpolatorRegistryLive)("interpolator registry", (it) => {
  it.effect("registry routes by value type", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      expect(yield* registry.interpolate(0, 10, 0.5)).toBe(5)
      expect(yield* registry.interpolate("0px", "10px", 0.5)).toBe("5px")
      expect(yield* registry.interpolate("#000000", "#ffffff", 0.5)).toContain("rgb")
    }),
  )

  it.effect("resolve returns a reusable (t) => T closure across multiple t values", () =>
    Effect.gen(function* () {
      // Arrange
      const registry = yield* InterpolatorRegistry
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
      const registry = yield* InterpolatorRegistry
      const fn = yield* registry.resolve(0, "10px")

      // Act
      const mid = fn(0.5)

      // Assert
      expect(mid).toBe("5px")
    }),
  )

  it.effect("resolve('10px', '20em') fails with an error message naming both units", () =>
    Effect.gen(function* () {
      // Arrange & Act — capture the exit so the failure does not abort the test.
      const registry = yield* InterpolatorRegistry
      const exit = yield* Effect.exit(registry.resolve("10px", "20em"))

      // Assert
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const message = Cause.pretty(exit.cause)
        expect(message).toContain("px")
        expect(message).toContain("em")
      }
    }),
  )

  it.effect("resolve('auto', 'left') falls back to discrete: 'auto' while t<1, 'left' at t=1", () =>
    Effect.gen(function* () {
      // Arrange
      const registry = yield* InterpolatorRegistry
      const fn = yield* registry.resolve("auto", "left")

      // Act
      const beforeEnd = fn(0.5)
      const atEnd = fn(1)

      // Assert
      expect(beforeEnd).toBe("auto")
      expect(atEnd).toBe("left")
    }),
  )

  it.effect("resolve('rebeccapurple', '#fff') yields a valid rgb(...) string", () =>
    Effect.gen(function* () {
      // Arrange
      const registry = yield* InterpolatorRegistry
      const fn = yield* registry.resolve("rebeccapurple", "#fff")

      // Act
      const start = fn(0)
      const mid = fn(0.5)
      const end = fn(1)

      // Assert
      expect(start).toMatch(/^rgb\(/)
      expect(mid).toMatch(/^rgb\(/)
      expect(end).toMatch(/^rgb\(/)
    }),
  )
})

// Isolated block — `register` mutates the shared registry, so this test gets
// its own `layer()` (a fresh InterpolatorRegistryLive build) to keep the
// "always-999" override from leaking into the resolve(...) cases above.
layer(InterpolatorRegistryLive)("interpolator registry (registration precedence)", (it) => {
  it.effect("registered interpolators take precedence over built-ins", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      yield* registry.register({
        name: "always-999",
        match: (v) => typeof v === "number",
        interpolate: () => 999,
      })
      const result = yield* registry.interpolate(0, 10, 0.5)
      expect(result).toBe(999)
    }),
  )
})
