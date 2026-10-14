// The DOM Environment's Positional keys (ADR-0036; ADR-0029): the transforms, and CSS's box keys,
// written as CSS names or in camelCase. Core names only the transforms.
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import { isPositional, PositionalKeysDomLive } from "@wardic/dom"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

it("PK1: the transforms and the box's position and size are positional, as Motion's positionalKeys", () => {
  for (const key of ["x", "y", "scale", "rotate", "skewX", "width", "height", "top", "left", "right", "bottom"]) {
    expect(isPositional(key), key).toBe(true)
  }
  for (const key of ["opacity", "background-color", "backgroundColor", "max-width", "maxWidth", "filter", "--x", "constructor"]) {
    expect(isPositional(key), key).toBe(false)
  }
})

it.effect("PK2: PositionalKeysDomLive provides it as the Environment's ReducedMotion.PositionalKeys", () =>
  Effect.gen(function* () {
    const keys = yield* ReducedMotion.PositionalKeys
    expect(keys.isPositional("width")).toBe(true)
    expect(keys.isPositional("opacity")).toBe(false)
  }).pipe(Effect.provide(PositionalKeysDomLive)),
)
