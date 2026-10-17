// A Layer-built service's runner (#132, ADR-0041; `internal/runner.ts`), as `FlushGate.make` and
// `ProjectionSystem.make` use it.
//
// - RN1: built inside a `ManagedRuntime.runSync` (a binding's first read), a fork resumes from a
//   yield on Effect's default scheduler, a macrotask, not on that `runSync`'s sync scheduler, a
//   microtask: the runner drops the scheduler of the call that built it.
// - RN2: a fork still running when the Layer's Scope closes is interrupted.
// - RN3: built under a host's async scheduler (Foldkit's shape: a microtask `MixedScheduler`
//   provided as a Layer), a fork resumes from a yield on that scheduler (#208).
// - RN4: a host's *sync* scheduler is dropped like `runSync`'s: a fork resumes on Effect's default.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scheduler from "effect/Scheduler"
import { describe, expect, it } from "vitest"
import { makeRunner, type Runner } from "../src/internal/runner.ts"

class Probe extends Context.Service<Probe, Runner<never>>()("test/runner") {}
const runtimeOf = () => ManagedRuntime.make(Layer.effect(Probe)(makeRunner<never>()))
/** The runner's Layer built under `scheduler`, provided as a host provides its own. */
const runtimeUnder = (scheduler: Scheduler.Scheduler) =>
  ManagedRuntime.make(Layer.effect(Probe)(makeRunner<never>()).pipe(Layer.provide(Layer.succeed(Scheduler.Scheduler, scheduler))))
/** A `MixedScheduler` of `mode` that dispatches on a microtask and counts its dispatches, as Foldkit's does. */
const recording = (mode: "sync" | "async") => {
  const counted = { dispatches: 0 }
  const scheduler = new Scheduler.MixedScheduler(mode, (task) => {
    counted.dispatches++
    queueMicrotask(task)
    return () => {}
  })
  return { scheduler, counted }
}
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe("a Layer-built service's runner (#132)", () => {
  it("RN1: built inside a runSync, a fork resumes from a yield on a macrotask, not a microtask", async () => {
    const runtime = runtimeOf()
    const runner = runtime.runSync(Probe)
    let resumed = false
    runner.runFork(Effect.andThen(Effect.yieldNow, Effect.sync(() => (resumed = true))))
    expect(resumed, "inline up to the yield").toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(resumed, "not on a microtask: not the runSync's sync scheduler").toBe(false)
    await macrotask()
    await macrotask()
    expect(resumed, "on a macrotask, Effect's default").toBe(true)
    await runtime.dispose()
  })

  it("RN2: a fork still running when the Scope closes is interrupted", async () => {
    const runtime = runtimeOf()
    const runner = runtime.runSync(Probe)
    const fiber = runner.runFork(Effect.never)
    await runtime.dispose()
    const exit = fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit), "interrupted with the Scope").toBe(true)
  })

  it("RN3: built under a host's async scheduler, a fork resumes from a yield on that scheduler (#208)", async () => {
    const host = recording("async")
    const runtime = runtimeUnder(host.scheduler)
    const runner = runtime.runSync(Probe)
    const before = host.counted.dispatches
    let resumed = false
    runner.runFork(Effect.andThen(Effect.yieldNow, Effect.sync(() => (resumed = true))))
    expect(resumed, "inline up to the yield").toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(resumed, "on a microtask: the host's scheduler").toBe(true)
    expect(host.counted.dispatches, "dispatched by the host's scheduler").toBeGreaterThan(before)
    await runtime.dispose()
  })

  it("RN4: a host's sync scheduler is dropped like runSync's: a fork resumes on Effect's default", async () => {
    const host = recording("sync")
    const runtime = runtimeUnder(host.scheduler)
    const runner = runtime.runSync(Probe)
    const before = host.counted.dispatches
    let resumed = false
    runner.runFork(Effect.andThen(Effect.yieldNow, Effect.sync(() => (resumed = true))))
    await Promise.resolve()
    await Promise.resolve()
    expect(resumed, "not on a microtask").toBe(false)
    await macrotask()
    await macrotask()
    expect(resumed, "on a macrotask, Effect's default").toBe(true)
    expect(host.counted.dispatches, "never dispatched by the host's sync scheduler").toBe(before)
    await runtime.dispose()
  })
})
