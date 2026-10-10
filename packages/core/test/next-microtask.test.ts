import * as Microtask from "@wardic/core/Microtask"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { MixedScheduler } from "effect/Scheduler"

// Node has `setImmediate`, so Effect's default scheduler dispatches through it.
// Browsers do not, and the scheduler falls back to `setTimeout(0)`. These tests
// replace the effect/Scheduler reference with that browser fallback, so they
// check real-browser timing: the continuation after `Microtask.next` must not
// depend on the scheduler at all.
const timeoutScheduler = new MixedScheduler("async", (task) => {
  const timer = setTimeout(task, 0)
  return () => clearTimeout(timer)
})

const nextTimeout = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe("Microtask.next", () => {
  it("resumes before a setTimeout(0) scheduled in the same synchronous block", async () => {
    const order: Array<string> = []
    // Scheduled first, so anything routed through the setTimeout-backed
    // scheduler would land after it.
    const timeoutFired = new Promise<void>((resolve) =>
      setTimeout(() => {
        order.push("timeout")
        resolve()
      }, 0),
    )
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Microtask.next
        order.push("microtask")
      }),
      { scheduler: timeoutScheduler },
    )

    await timeoutFired
    expect(order).toEqual(["microtask", "timeout"])
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("runs the continuation inside the microtask, ahead of later-queued microtasks", async () => {
    const order: Array<string> = []
    Effect.runFork(
      Effect.gen(function* () {
        yield* Microtask.next
        order.push("continuation")
      }),
      { scheduler: timeoutScheduler },
    )
    queueMicrotask(() => order.push("later microtask"))

    await nextTimeout()
    expect(order).toEqual(["continuation", "later microtask"])
  })

  it("never runs the continuation when the fiber is interrupted before the microtask", async () => {
    const order: Array<string> = []
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Microtask.next
        order.push("continuation")
      }),
      { scheduler: timeoutScheduler },
    )
    // Fiber.interrupt interrupts synchronously when run, still inside this
    // task, so the pending microtask's resume finds the fiber already done.
    Effect.runFork(Fiber.interrupt(fiber))

    await nextTimeout()
    expect(order).toEqual([])
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Exit.hasInterrupts(exit)).toBe(true)
  })
})
