import { cleanup, render } from "@solidjs/testing-library"
import { expect, it, vi } from "vitest"
import * as Clock from "@wardic/core/Clock"
import { TestLive } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as LogLevel from "effect/LogLevel"
import * as References from "effect/References"
import * as Scope from "effect/Scope"
import { createRoot } from "solid-js"
import { domAnimation, runScoped, useWardicRuntime, w, WardicProvider } from "@wardic/solid"

it("useWardicRuntime() inside the provider resolves a runtime wired to env", async () => {
  let captured: ReturnType<typeof useWardicRuntime> | undefined

  function Probe() {
    captured = useWardicRuntime()
    return <div>probe</div>
  }

  render(() => (
    <WardicProvider env={TestLive}>
      <Probe />
    </WardicProvider>
  ))

  expect(captured).toBeDefined()
  // A service from TestLive resolves through the runtime — proving it is wired
  // to the supplied env.
  const clock = await captured!.runPromise(
    Effect.gen(function*() {
      return yield* Clock.Clock
    }),
  )
  expect(clock).toBeDefined()

  cleanup()
})

it("useWardicRuntime() outside a provider throws a clear, named error", () => {
  expect(() =>
    createRoot((dispose) => {
      try {
        useWardicRuntime()
      } finally {
        dispose()
      }
    })
  ).toThrow("useWardicRuntime must be used within a <WardicProvider>")
})

it("disposes the runtime on unmount", async () => {
  const disposed = vi.fn<() => void>()

  // A finalizer layer whose finalizer runs only when the layer's scope is
  // closed — which happens exactly when the runtime is disposed. Merged into
  // the env so it shares the runtime's scope. Asserting the finalizer ran
  // proves WardicProvider called runtime.dispose() on unmount.
  const env = Layer.mergeAll(
    TestLive,
    Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(disposed))),
  )

  // Build the layer once (ManagedRuntime builds lazily on first use) so the
  // finalizer is actually registered; otherwise dispose has nothing to run.
  let built: Promise<unknown> | undefined
  function Probe() {
    built = useWardicRuntime().runPromise(Effect.gen(function*() {
      return yield* Clock.Clock
    }))
    return <div>child</div>
  }

  render(() => (
    <WardicProvider env={env}>
      <Probe />
    </WardicProvider>
  ))

  await built
  expect(disposed).not.toHaveBeenCalled()
  cleanup()
  await vi.waitFor(() => {
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})

it("interrupts a runScoped fiber on the consuming component's unmount", async () => {
  let interrupted = false

  function Consumer() {
    const runtime = useWardicRuntime()
    runScoped(
      runtime,
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true
          })
        ),
      ),
    )
    return <div>consumer</div>
  }

  render(() => (
    <WardicProvider env={TestLive}>
      <Consumer />
    </WardicProvider>
  ))

  expect(interrupted).toBe(false)
  cleanup()
  // Interruption (and thus the finalizer) runs asynchronously on the runtime.
  await vi.waitFor(() => {
    expect(interrupted).toBe(true)
  })
})

/** A Layer that waits as it builds, as `DevTools.layer()` waits for its connection: the Debug log level, a moment later. */
const waits = Layer.effect(References.MinimumLogLevel, Effect.as(Effect.sleep("1 millis"), "Debug" as const))

it("an env that waits as it builds fails its first element with an error naming the fix", () => {
  expect(() =>
    render(() => (
      <WardicProvider env={Layer.mergeAll(TestLive, waits)} features={[domAnimation]}>
        <w.div animate={{ opacity: 1 }} />
      </WardicProvider>
    ))
  ).toThrow(/env waits as it builds.*before the app renders/)
  cleanup()
})

it("a Layer that waits, built before the render and given as its services, reaches the runtime", async () => {
  const built = await Effect.runPromise(Layer.buildWithScope(waits, Scope.makeUnsafe()))
  let level: LogLevel.LogLevel | undefined
  function Probe() {
    level = useWardicRuntime().runSync(References.MinimumLogLevel)
    return <w.div animate={{ opacity: 1 }} />
  }
  render(() => (
    <WardicProvider env={Layer.mergeAll(TestLive, Layer.succeedContext(built))} features={[domAnimation]}>
      <Probe />
    </WardicProvider>
  ))
  expect(level).toBe("Debug")
  cleanup()
})
