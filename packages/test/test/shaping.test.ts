import * as Drag from "@wardic/core/Drag"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/** Build a Drag.Sample with sensible defaults; override per-field. */
const sample = (over: Partial<Drag.Sample> = {}): Drag.Sample => ({
  point: { x: 0, y: 0 },
  offset: { x: 0, y: 0 },
  delta: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  phase: "move",
  timeStamp: 0,
  ...over,
})

const collect = <E, R>(stream: Stream.Stream<Drag.Sample, E, R>) =>
  Stream.runCollect(stream) as Effect.Effect<ReadonlyArray<Drag.Sample>, E, R>

it.effect("withinBounds hard clamp (elastic 0) clamps offset to min/max", () =>
  Effect.gen(function* () {
    const below = sample({ offset: { x: -50, y: 0 } })
    const above = sample({ offset: { x: 0, y: 500 } })
    const out = yield* collect(
      Stream.fromIterable([below, above]).pipe(
        Drag.withinBounds({ x: { min: 0, max: 200 }, y: { min: 0, max: 200 } }),
      ),
    )

    expect(out[0]!.offset.x).toBe(0) // -50 clamped up to min 0
    expect(out[1]!.offset.y).toBe(200) // 500 clamped down to max 200
  }))

it.effect("withinBounds elastic (0.5) resists overshoot past a bound by the factor", () =>
  Effect.gen(function* () {
    // 50px past max 200 with elastic 0.5 => 200 + 50 * 0.5 = 225.
    const overMax = sample({ offset: { x: 250, y: 0 } })
    // 40px below min 0 with elastic 0.5 => 0 - 40 * 0.5 = -20.
    const underMin = sample({ offset: { x: -40, y: 0 } })
    const out = yield* collect(
      Stream.fromIterable([overMax, underMin]).pipe(
        Drag.withinBounds({ x: { min: 0, max: 200 } }, { elastic: 0.5 }),
      ),
    )

    expect(out[0]!.offset.x).toBe(225)
    expect(out[1]!.offset.x).toBe(-20)
  }))

it.effect("withinBounds passes through an axis with no range and an in-range value", () =>
  Effect.gen(function* () {
    const input = sample({ offset: { x: 999, y: 50 } })
    const out = yield* collect(
      // x has no range -> pass through; y in [0,200] -> unchanged.
      Stream.make(input).pipe(Drag.withinBounds({ y: { min: 0, max: 200 } })),
    )

    expect(out[0]!.offset).toEqual({ x: 999, y: 50 })
  }))
