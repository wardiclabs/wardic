// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { domAnimation, w, WardicConfig, WardicProvider } from "@wardic/solid"
import type { JSX } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

/** What's under test: a notice that fades in, and a button that grows under the pointer. */
function Notice() {
  return (
    <>
      <w.p role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: "linear" }}>
        Saved
      </w.p>
      <w.button whileHover={{ scale: 1.1 }}>Undo</w.button>
    </>
  )
}

/** The provider, as the app has it. */
const withWardic = (ui: () => JSX.Element) => () => (
  <WardicProvider env={DomLive} features={[domAnimation]}>
    {ui()}
  </WardicProvider>
)

// Wardic draws on animation frames, which fake timers fake too: the test moves time itself.
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it("fades the notice in", async () => {
  render(withWardic(() => <Notice />))
  const notice = screen.getByRole("status")
  expect(notice.style.opacity).toBe("0")
  await vi.advanceTimersByTimeAsync(100)
  expect(Number(notice.style.opacity)).toBeCloseTo(0.5, 1)
  await vi.advanceTimersByTimeAsync(150)
  expect(notice.style.opacity).toBe("1")
})

it("grows the button under the pointer", async () => {
  render(withWardic(() => <Notice />))
  const button = screen.getByRole("button", { name: "Undo" })
  fireEvent.pointerEnter(button, { pointerType: "mouse" })
  await vi.advanceTimersByTimeAsync(1000)
  expect(button.style.transform).toBe("scale(1.1)")
})

it("shows the notice at once with the animations skipped", async () => {
  render(withWardic(() => (
    <WardicConfig skipAnimations>
      <Notice />
    </WardicConfig>
  )))
  await vi.advanceTimersByTimeAsync(20)
  expect(screen.getByRole("status").style.opacity).toBe("1")
})
