// `Report.debugOf` (#618, M4): a lifecycle debug log that reads the log level once.
//
// - DL1: where a Debug log is kept, `on` and `debugKept` are true, and a log arrives as `scope: event` with
//   its annotations.
// - DL2: at the default level, `on` and `debugKept` are false, and a log forks nothing.
import * as Report from "@wardic/dom/Report"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Match from "effect/Match"
import * as References from "effect/References"
import { describe, expect, it } from "vitest"

/** A runner over `runtime` that counts its forks. */
const counting = <R,>(runtime: ManagedRuntime.ManagedRuntime<R, never>) => {
  let forks = 0
  return {
    forks: () => forks,
    runner: {
      runSync: <A,>(effect: Effect.Effect<A>): A => runtime.runSync(effect),
      runFork: <A,>(effect: Effect.Effect<A>): unknown => {
        forks++
        return runtime.runFork(effect)
      },
    },
  }
}

describe("Report.debugOf (#618)", () => {
  it("DL1: where a Debug log is kept, a log arrives with its annotations", async () => {
    const logged: Array<{ readonly message: string; readonly annotations: Record<string, unknown> }> = []
    const logger = Logger.make(({ message, fiber }) => {
      logged.push({ message: String(Match.value(message).pipe(Match.when(Array.isArray, (parts) => parts[0]), Match.orElse((one) => one))), annotations: { ...fiber.getRef(References.CurrentLogAnnotations) } })
    })
    const runtime = ManagedRuntime.make(Layer.mergeAll(Logger.layer([logger]), Layer.succeed(References.MinimumLogLevel, "Debug")))
    const { runner } = counting(runtime)
    const debug = Report.debugOf(runner, "wardic.test")
    expect(debug.on).toBe(true)
    expect(runtime.runSync(Report.debugKept)).toBe(true)
    debug("register", { id: "a" })
    await Effect.runPromise(Effect.yieldNow)
    expect(logged).toEqual([{ message: "wardic.test: register", annotations: { id: "a" } }])
    await runtime.dispose()
  })

  it("DL2: at the default level, a log forks nothing", async () => {
    const runtime = ManagedRuntime.make(Layer.empty)
    const { runner, forks } = counting(runtime)
    const debug = Report.debugOf(runner, "wardic.test")
    expect(debug.on).toBe(false)
    expect(runtime.runSync(Report.debugKept)).toBe(false)
    debug("register", { id: "a" })
    debug("dispose node")
    expect(forks()).toBe(0)
    await runtime.dispose()
  })
})
