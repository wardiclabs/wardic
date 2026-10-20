// The Solid 2 binding's WardicProvider (#209), as the Solid 1 binding's provider tests pin it:
// a runtime wired to its Environment, a clear error outside one, the runtime disposed on unmount,
// and a runScoped fiber interrupted when its owner is.
import * as Clock from "@wardic/core/Clock"
import { TestLive } from "@wardic/test"
import { runScoped, useWardicRuntime, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createRoot } from "solid-js"
import { expect, it, vi } from "vitest"
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
