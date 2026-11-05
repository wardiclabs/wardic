// The Scopes a binding opens on its provider's runtime (#618: decision 5, L1; `src/owner-scope.ts`).
//
// - OS1: one its owner never closed ends with the runtime: a child of the runtime's Scope.
// - OS2: closed with a finalizer that fails, it throws nothing, its other finalizers still run, and the
//   failure is logged and reported through the runtime's ErrorReporters.
// - OS3: closed after the runtime has gone, it does nothing: the runtime closed it already.
// - OS4: closed first, it leaves its parent: the runtime's Scope keeps no finalizer for it.
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Exit from "effect/Exit"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import { describe, expect, it } from "vitest"
import * as OwnerScope from "../src/owner-scope.ts"

/** A runtime whose ErrorReporter appends each reported error's message to `reports`. */
const runtimeOf = (reports: Array<string>) =>
  ManagedRuntime.make(ErrorReporter.layer([ErrorReporter.make(({ error }) => void reports.push(error.message))]))

/** `finalizer` added to `scope`, run on `runtime`. */
const finalize = (runtime: ManagedRuntime.ManagedRuntime<never, never>, scope: Scope.Closeable, finalizer: Effect.Effect<void>): void =>
  runtime.runSync(Scope.addFinalizer(scope, finalizer))

describe("a binding's Scopes on its provider's runtime (#618)", () => {
  it("OS1: one its owner never closed ends with the runtime", async () => {
    const runtime = runtimeOf([])
    const scope = OwnerScope.open(runtime)
    const ran: Array<string> = []
    finalize(runtime, scope, Effect.sync(() => void ran.push("closed")))
    await runtime.dispose()
    expect(ran).toEqual(["closed"])
    expect(scope.state._tag).toBe("Closed")
  })

  it("OS2: a failing finalizer throws nothing, the others run, and the failure is reported", async () => {
    const reports: Array<string> = []
    const runtime = runtimeOf(reports)
    const scope = OwnerScope.open(runtime)
    const ran: Array<string> = []
    finalize(runtime, scope, Effect.sync(() => void ran.push("first added")))
    finalize(runtime, scope, Effect.die(new Error("finalizer broke")))
    finalize(runtime, scope, Effect.sync(() => void ran.push("last added")))
    expect(() => OwnerScope.close(runtime, scope, "test: a finalizer failed")).not.toThrow()
    expect(ran, "every finalizer ran, in reverse").toEqual(["last added", "first added"])
    await Effect.runPromise(Effect.yieldNow)
    expect(reports).toEqual(["finalizer broke"])
    await runtime.dispose()
  })

  it("OS3: closed after the runtime has gone, it does nothing", async () => {
    const reports: Array<string> = []
    const runtime = runtimeOf(reports)
    const scope = OwnerScope.open(runtime)
    const ran: Array<string> = []
    finalize(runtime, scope, Effect.sync(() => void ran.push("closed")))
    await runtime.dispose()
    expect(() => OwnerScope.close(runtime, scope, "test: a finalizer failed")).not.toThrow()
    expect(ran, "closed once, by the runtime").toEqual(["closed"])
    expect(reports).toEqual([])
  })

  it("OS4: closed first, it leaves its parent", async () => {
    const runtime = runtimeOf([])
    const scope = OwnerScope.open(runtime)
    const ran: Array<string> = []
    finalize(runtime, scope, Effect.sync(() => void ran.push("closed")))
    OwnerScope.close(runtime, scope, "test: a finalizer failed")
    const exit = await Effect.runPromiseExit(runtime.disposeEffect)
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(ran, "not run again by the runtime").toEqual(["closed"])
  })
})

