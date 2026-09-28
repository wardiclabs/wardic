// The card's `passes N (M seeding)`, in the node test tier. The span fixtures are
// literals copied from Devin's saved Chrome 153 logs: scenario 7's `layoutId` switch
// after #2's fix (`logs/2026-09-28T18-50-29-479Z-default.json`, run 11) and before it
// (`logs/2026-09-28T06-24-31-748Z-default.json`, run 23, whose spans carry no
// `seeded` yet). The logs are gitignored, so the numbers live here.
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import { formatPasses, measurePassesOf } from "../src/lab/measure-passes.ts"
import { makeTimeline, type SpanRecord } from "../src/probe/timeline.ts"

/** A span record with the given name, times and attributes; `end` undefined is a span still in flight. */
const span = (
  name: string,
  start: number,
  end: number | undefined,
  attributes: Readonly<Record<string, unknown>>,
): SpanRecord =>
  end === undefined
    ? { id: `${name}@${start}`, name, start, attributes, scheduler: "default" }
    : { id: `${name}@${start}`, name, start, end, attributes, exitTag: "Success", scheduler: "default" }

const MEASURE = "wardic.projection.measure"
const COORDINATOR = "wardic.projection.coordinator"

/** Scenario 7 after the fix: the click's pass seeds the twin, the observer's first delivery seeds nothing. */
const fixedS7Trigger = 25664.799999952316
const fixedS7Spans: ReadonlyArray<SpanRecord> = [
  span("wardic.projection.leaverHold", 25666.700000047684, 25667.399999976158, { layoutId: "lab-s7-page", seed: "consumed" }),
  span(MEASURE, 25667.5, 25668.299999952316, { nodes: 9, active: 1, seeded: 1, rounds: 1 }),
  span(COORDINATOR, 25668.100000023842, 26382.299999952316, { active: 1 }),
  span(MEASURE, 25669, 25669.200000047684, { nodes: 9, active: 1, seeded: 0, rounds: 1 }),
]

/** Scenario 7 before the fix: two passes, and no `seeded` attribute on either. */
const oldS7Trigger = 166533.89999997616
const oldS7Spans: ReadonlyArray<SpanRecord> = [
  span(MEASURE, 166542.69999992847, 166543.29999995232, { nodes: 9, active: 1 }),
  span(COORDINATOR, 166543.09999990463, 167291.89999997616, { active: 1 }),
  span(MEASURE, 166556.89999997616, 166558.09999990463, { nodes: 9, active: 1 }),
]

describe("measurePassesOf", () => {
  it("counts every Measure pass at or after the trigger, and those that seeded (scenario 7: 2, 1 seeding)", () => {
    const passes = measurePassesOf(fixedS7Spans, fixedS7Trigger)
    expect(passes).toEqual({ count: 2, seeding: 1, starts: [25667.5, 25669] })
    expect(formatPasses(passes)).toBe("2 (1 seeding)")
  })

  it("leaves out a pass that started before the trigger, and counts one in the trigger's millisecond", () => {
    // A pass from an earlier run, 5 ms before this trigger, and a later one in this run.
    const spans = [span(MEASURE, 25660, 25661, { seeded: 1 }), ...fixedS7Spans, span(MEASURE, 25870, 25870.5, { seeded: 2 })]
    expect(measurePassesOf(spans, fixedS7Trigger)).toEqual({ count: 3, seeding: 2, starts: [25667.5, 25669, 25870] })
    // Firefox's whole-millisecond timer: a pass in the trigger's own millisecond is the trigger's.
    expect(measurePassesOf([span(MEASURE, 5100, 5101, { seeded: 1 })], 5100)).toEqual({ count: 1, seeding: 1, starts: [5100] })
  })

  it("counts a span with no `seeded` (a log from before the fix, or a span still in flight) as not seeding", () => {
    expect(measurePassesOf(oldS7Spans, oldS7Trigger)).toEqual({
      count: 2,
      seeding: 0,
      starts: [166542.69999992847, 166556.89999997616],
    })
    expect(measurePassesOf([span(MEASURE, 10, undefined, {})], 0)).toEqual({ count: 1, seeding: 0, starts: [10] })
  })

  it("reads `passes 0` for a run no Measure pass answered (scenario 9's spring)", () => {
    const passes = measurePassesOf([span(COORDINATOR, 12, 400, {}), span("wardic.clock", 12, undefined, {})], 10)
    expect(passes).toEqual({ count: 0, seeding: 0, starts: [] })
    expect(formatPasses(passes)).toBe("0")
  })

  it("reads `seeded` as the timeline records it at the span's end", async () => {
    const timeline = makeTimeline()
    await Effect.runPromise(
      Effect.annotateCurrentSpan({ nodes: 3, active: 1, seeded: 1, rounds: 1 }).pipe(
        Effect.withSpan(MEASURE),
        Effect.andThen(Effect.void.pipe(Effect.withSpan(MEASURE))),
        Effect.provide(timeline.layer),
      ),
    )
    const spans = timeline.window(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY).spans
    expect(spans.map((s) => s.attributes.seeded)).toEqual([1, undefined])
    const passes = measurePassesOf(spans, Number.NEGATIVE_INFINITY)
    expect(formatPasses(passes)).toBe("2 (1 seeding)")
  })
})
