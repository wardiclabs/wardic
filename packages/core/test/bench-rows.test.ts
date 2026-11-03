import { describe, expect, it } from "vitest"
import { confirmed, rowsOf, runsOf } from "../bench/rows.ts"

// How the bench runner reports each workload from the names each side ran (#74). Before, every
// workload only head ran was read as a Frame loop workload against the base's `<name>`, so a new
// plain one threw a TypeError, and a workload only the base ran left the gate silently.
describe("bench:core's rows", () => {
  it("a workload both sides ran is gated, in head's order", () => {
    expect(rowsOf(["ticksOnly", "springValues"], ["springValues", "ticksOnly"])).toEqual([
      { kind: "gated", workload: "springValues" },
      { kind: "gated", workload: "ticksOnly" },
    ])
  })

  it("a Frame loop workload only head ran is reported against the base's same Primitive", () => {
    expect(rowsOf(["springValues"], ["springValues", "springValues/loop"])).toEqual([
      { kind: "gated", workload: "springValues" },
      { kind: "loop", workload: "springValues/loop", fibers: "springValues" },
    ])
  })

  it("a Frame loop workload with both sides is gated like any other", () => {
    expect(rowsOf(["chase", "chase/loop"], ["chase", "chase/loop"])).toEqual([
      { kind: "gated", workload: "chase" },
      { kind: "gated", workload: "chase/loop" },
    ])
  })

  it("any other workload only head ran is new: a plain one, or a loop one with no base Primitive", () => {
    expect(rowsOf(["ticksOnly"], ["ticksOnly", "animateComplex", "animateComplex/loop"])).toEqual([
      { kind: "gated", workload: "ticksOnly" },
      { kind: "new", workload: "animateComplex" },
      { kind: "new", workload: "animateComplex/loop" },
    ])
  })

  it("a workload only the base ran gets a row after head's", () => {
    expect(rowsOf(["ticksOnly", "animateComplex", "chase/loop"], ["ticksOnly"])).toEqual([
      { kind: "gated", workload: "ticksOnly" },
      { kind: "dropped", workload: "animateComplex" },
      { kind: "dropped", workload: "chase/loop" },
    ])
  })

  // #545: the runs a side timed, and a failure the rerun confirms.
  it("a side's runs are its own count, or N from a harness before #545", () => {
    expect(runsOf({ runs: 10_000 }, 1000)).toBe(10_000)
    expect(runsOf({}, 1000)).toBe(1000)
  })

  it("a workload fails the gate only when it fails an engine's run and its rerun", () => {
    expect(confirmed(new Set(["chase/loop", "animateRepeat/loop"]), new Set(["animateRepeat/loop", "springBlend/loop"]))).toEqual([
      "animateRepeat/loop",
    ])
    expect(confirmed(new Set(["chase/loop"]), new Set())).toEqual([])
  })
})
