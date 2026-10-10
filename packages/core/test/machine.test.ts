import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

/**
 * The `Machine` data type and its operations' types (ADR-0028, decisions 3 and 9). The type
 * assertions run under `bun run typecheck` (`typecheck:tests`); the rest under `bun run test`.
 */
const spring = Machine.spring(100)
const tween = Machine.tween(0, 10, { duration: 1 })
const double = (frame: Frame.Frame<number>): Frame.Frame<number> => ({ value: frame.value * 2, done: frame.done })
const ignore = (): undefined => undefined

describe("the data type", () => {
  it("a literal isn't a Machine: its TypeId and pipe are required", () => {
    // @ts-expect-error TS2739: an object literal lacks `[TypeId]`, `pipe` and Inspectable's members.
    const literal: Machine.Machine<Frame.Frame<number>> = {
      start: () => () => ({ value: 0, done: true }),
      settles: true,
      span: { name: "test.literal", attributes: {} },
    }
    expect(Machine.isMachine(literal)).toBe(false)
  })

  it("isMachine: constructors and make, not a spread", () => {
    expect(Machine.isMachine(tween)).toBe(true)
    expect(Machine.isMachine(Machine.make({ start: tween.start, settles: true, span: tween.span }))).toBe(true)
    expect(Machine.isMachine({ ...tween })).toBe(false)
    expect(Machine.isMachine(null)).toBe(false)
    expect(Machine.isMachine(tween.start)).toBe(false)
  })

  it("pipe: a machine runs through its combinators, and on into an Effect", () => {
    const piped = tween.pipe(Machine.map(double), Machine.delay(0.1), Machine.withSpan("app.piped"))
    expect(Machine.isMachine(piped)).toBe(true)
    expect(piped.span.name).toBe("app.piped")
    expect(Effect.isEffect(tween.pipe(Machine.run(ignore)))).toBe(true)
  })

  it("toJSON and toString show the span and whether it settles", () => {
    expect(tween.toJSON()).toEqual({
      _id: "Machine",
      span: { name: "wardic.tween", attributes: { from: 0, to: 10, duration: 1 } },
      settles: true,
    })
    expect(JSON.parse(String(Machine.chase(() => 0)))).toMatchObject({ _id: "Machine", settles: false })
  })
})

describe("each dual operation's two forms give one type", () => {
  it("map, concat, delay, clampDt, withSpan, run", () => {
    expectTypeOf(Machine.map(tween, double)).toEqualTypeOf(tween.pipe(Machine.map(double)))
    expectTypeOf(Machine.map(tween, double)).toEqualTypeOf<Machine.Machine<Frame.Frame<number>>>()
    expectTypeOf(Machine.concat(tween, spring)).toEqualTypeOf(tween.pipe(Machine.concat(spring)))
    expectTypeOf(Machine.concat(tween, spring)).toEqualTypeOf<Machine.Machine<Frame.Frame<number> | Frame.Physics>>()
    expectTypeOf(Machine.delay(spring, 0.1)).toEqualTypeOf(spring.pipe(Machine.delay(0.1)))
    expectTypeOf(Machine.delay(spring, 0.1)).toEqualTypeOf<Machine.Machine<Frame.Physics>>()
    expectTypeOf(Machine.clampDt(spring, 0.5)).toEqualTypeOf(spring.pipe(Machine.clampDt(0.5)))
    expectTypeOf(Machine.withSpan(spring, "a", { attributes: {} })).toEqualTypeOf(spring.pipe(Machine.withSpan("a")))
    expectTypeOf(Machine.run(spring, ignore)).toEqualTypeOf(spring.pipe(Machine.run(ignore)))
    expectTypeOf(Machine.run(spring, ignore)).toEqualTypeOf<Effect.Effect<Frame.Physics, never, FrameLoop.FrameLoop>>()
    expectTypeOf(Machine.forever(spring)).toEqualTypeOf(spring.pipe(Machine.forever))
    expectTypeOf(Machine.concatAll([tween, tween])).toEqualTypeOf<Machine.Machine<Frame.Frame<number>>>()
  })

  it("the constructors that need a service return an Effect, and the combinators compose under it", () => {
    const blend = Machine.springBlend({ x: 0 }, { x: 1 })
    expectTypeOf(blend).toEqualTypeOf<Effect.Effect<Machine.Machine<Frame.Frame<Values.Values>>, never, InterpolatorRegistry.InterpolatorRegistry>>()
    expectTypeOf(blend.pipe(Effect.map(Machine.delay(0.1)))).toEqualTypeOf(blend)
    expectTypeOf(Machine.springValues({ x: 1 })).toEqualTypeOf<Machine.Machine<Frame.MultiPhysics>>()
  })
})

describe("a sink", () => {
  it("an inline sink's frame takes the machine's F in a pipe, under an Effect too", () => {
    Machine.springValues({ x: 1 }).pipe(
      Machine.run((frame) => {
        expectTypeOf(frame).toEqualTypeOf<Frame.MultiPhysics>()
        return undefined
      }),
    )
    Machine.animateValues({ x: 0 }, { x: 1 }).pipe(
      Effect.flatMap(
        Machine.run((frame) => {
          expectTypeOf(frame).toEqualTypeOf<Frame.Frame<Values.Values>>()
          return undefined
        }),
      ),
    )
  })

  it("a sink that returns an Effect doesn't compile (ADR-0027, decision 8)", () => {
    // @ts-expect-error TS2322: a sink returns `undefined`, so the Effect isn't dropped silently.
    spring.pipe(Machine.run(() => Effect.void))
    // @ts-expect-error TS2322: data-first too.
    Machine.run(spring, () => Effect.log("dropped"))
  })
})
