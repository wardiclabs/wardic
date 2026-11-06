// The Solid 2 binding's WardicProvider (#209), as the Solid 1 binding's provider tests pin it:
// a runtime wired to its Environment, a clear error outside one, the runtime disposed on unmount,
// a runScoped fiber interrupted when its owner is, and a clear error for an env that waits as it builds.
import * as Clock from "@wardic/core/Clock"
import { TestLive } from "@wardic/test"
import { domAnimation, runScoped, useWardicRuntime, w, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as LogLevel from "effect/LogLevel"
import * as References from "effect/References"
import * as Scope from "effect/Scope"
import { createRoot, Errored } from "solid-js"
import { expect, it, vi } from "vitest"
import { until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

it("useWardicRuntime() inside the provider resolves a runtime wired to its env", async () => {
  let captured: ReturnType<typeof useWardicRuntime> | undefined
  const Probe = () => {
    captured = useWardicRuntime()
    return <div>probe</div>
  }
  mount(() => (
    <WardicProvider env={TestLive}>
      <Probe />
    </WardicProvider>
  ))
  expect(captured).toBeDefined()
  expect(await captured!.runPromise(Effect.gen(function* () { return yield* Clock.Clock }))).toBeDefined()
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
  const env = Layer.mergeAll(TestLive, Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(disposed))))
  let built: Promise<unknown> | undefined
  const Probe = () => {
    built = useWardicRuntime().runPromise(Effect.gen(function* () { return yield* Clock.Clock }))
    return <div>child</div>
  }
  const { unmount } = mount(() => (
    <WardicProvider env={env}>
      <Probe />
    </WardicProvider>
  ))
  await built
  expect(disposed).not.toHaveBeenCalled()
  unmount()
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1))
})

it("interrupts a runScoped fiber when its owner is disposed", async () => {
  let interrupted = false
  const Consumer = () => {
    runScoped(useWardicRuntime(), Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => {
      interrupted = true
    }))))
    return <div>consumer</div>
  }
  const { unmount } = mount(() => (
    <WardicProvider env={TestLive}>
      <Consumer />
    </WardicProvider>
  ))
  expect(interrupted).toBe(false)
  unmount()
  await vi.waitFor(() => expect(interrupted).toBe(true))
})

/** A Layer that waits as it builds, as `DevTools.layer()` waits for its connection: the Debug log level, a moment later. */
const waits = Layer.effect(References.MinimumLogLevel, Effect.as(Effect.sleep("1 millis"), "Debug" as const))

it("an env that waits as it builds fails its first element with an error naming the fix", async () => {
  const { host } = mount(() => (
    <WardicProvider env={Layer.mergeAll(TestLive, waits)} features={[domAnimation]}>
      <Errored fallback={(error) => <p>{String(error())}</p>}>
        <w.div animate={{ opacity: 1 }} />
      </Errored>
    </WardicProvider>
  ))
  await until(() => host.querySelector("p") !== null)
  expect(host.querySelector("p")?.textContent).toMatch(/env waits as it builds.*before the app renders/)
})

it("a Layer that waits, built before the render and given as its services, reaches the runtime", async () => {
  const built = await Effect.runPromise(Layer.buildWithScope(waits, Scope.makeUnsafe()))
  let level: LogLevel.LogLevel | undefined
  const Probe = () => {
    level = useWardicRuntime().runSync(References.MinimumLogLevel)
    return <w.div animate={{ opacity: 1 }} />
  }
  mount(() => (
    <WardicProvider env={Layer.mergeAll(TestLive, Layer.succeedContext(built))} features={[domAnimation]}>
      <Probe />
    </WardicProvider>
  ))
  expect(level).toBe("Debug")
})
