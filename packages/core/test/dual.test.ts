import * as Drag from "@wardic/core/Drag"
import type * as Frame from "@wardic/core/Frame"
import * as Renderer from "@wardic/core/Renderer"
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as Machine from "@wardic/core/Machine"
import { dual } from "../src/internal/dual.ts"

/**
 * The operations #95 made `dual`, the stream first (ADR-0028, decision 12): both forms give one
 * type, and both run. The type assertions run under `bun run typecheck` (`typecheck:tests`).
 */
const sample = (x: number, y: number): Drag.Sample => ({
  point: { x, y },
  offset: { x, y },
  delta: { x, y },
  velocity: { x, y },
  phase: "move",
  timeStamp: 0,
  scroll: { x: 0, y: 0 },
  axis: "xy",
})
const samples: Stream.Stream<Drag.Sample> = Stream.make(sample(10, 20), sample(-30, 250))
const frames: Stream.Stream<Frame.Frame<Record<string, unknown>>> = Stream.make({ value: { x: 1 }, done: true })

describe("Drag.withinBounds, the stream first", () => {
  it("both forms give one type", () => {
    expectTypeOf(Drag.withinBounds(samples, { x: { min: 0 } })).toEqualTypeOf(samples.pipe(Drag.withinBounds({ x: { min: 0 } })))
    expectTypeOf(Drag.withinBounds(samples, {}, { elastic: 0.5 })).toEqualTypeOf<Stream.Stream<Drag.Sample>>()
  })

  it.effect("both forms run alike", () =>
    Effect.gen(function* () {
      const offsets = (stream: Stream.Stream<Drag.Sample>) =>
        Stream.runCollect(stream).pipe(Effect.map((all) => Array.from(all, (s) => s.offset)))
      const bounds = { x: { min: 0 }, y: { max: 200 } }
      expect(yield* offsets(Drag.withinBounds(samples, bounds, { elastic: 0.5 }))).toEqual(
        yield* offsets(samples.pipe(Drag.withinBounds(bounds, { elastic: 0.5 }))),
      )
      expect(yield* offsets(samples.pipe(Drag.withinBounds(bounds)))).toEqual([
        { x: 10, y: 20 },
        { x: 0, y: 200 },
      ])
    }))
})

describe("Renderer.applyTo, the stream first", () => {
  it("both forms give one type", () => {
    expectTypeOf(Renderer.applyTo(frames, "target")).toEqualTypeOf(frames.pipe(Renderer.applyTo("target")))
    expectTypeOf(Renderer.applyTo(frames, "target")).toEqualTypeOf<Effect.Effect<void, never, Renderer.Renderer>>()
  })
})

describe("core's dual (#460): both forms, told apart without `arguments`", () => {
  const isBox = (u: unknown): u is { readonly n: number } => Predicate.hasProperty(u, "n")
  const add: {
    (by: number, times?: number): (self: { readonly n: number }) => number
    (self: { readonly n: number }, by: number, times?: number): number
  } = dual(isBox, (self: { readonly n: number }, by: number, times = 1): number => self.n + by * times)
  const scale: {
    (by: number): (self: number) => number
    (self: number, by: number): number
  } = dual(2, (self: number, by: number): number => self * by)
  const between: {
    (lo: number, hi: number): (self: number) => boolean
    (self: number, lo: number, hi: number): boolean
  } = dual(3, (self: number, lo: number, hi: number): boolean => self >= lo && self <= hi)

  it("by the first argument, an optional one left out or given", () => {
    expect(add({ n: 1 }, 2)).toBe(3)
    expect(add({ n: 1 }, 2, 3)).toBe(7)
    expect(add(2)({ n: 1 })).toBe(3)
    expect(add(2, 3)({ n: 1 })).toBe(7)
  })

  it("by arity: two and three", () => {
    expect(scale(3, 2)).toBe(6)
    expect(scale(2)(3)).toBe(6)
    expect(between(5, 0, 10)).toBe(true)
    expect(between(0, 10)(11)).toBe(false)
  })

  it("Machine's combinators run alike in both forms", () => {
    const m = Machine.tween(0, 10, { duration: 0.1 })
    const first = Machine.delay(Machine.withSpan(m, "app.a"), 0.05)
    const last = m.pipe(Machine.withSpan("app.a"), Machine.delay(0.05))
    expect(first.span).toEqual(last.span)
    const stepFirst = first.start()
    const stepLast = last.start()
    expect([0.03, 0.03, 0.06].map((dt) => stepFirst(dt))).toEqual([0.03, 0.03, 0.06].map((dt) => stepLast(dt)))
  })
})
