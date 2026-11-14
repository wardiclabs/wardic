// @vitest-environment jsdom
import { type JSX, render } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { WardicConfig, WardicProvider } from "@wardic/solid/unstable/v2"
import { w } from "~/lib/wardic.ts"
import { createEffect } from "solid-js"
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest"

/** What's under test: a notice that fades in, and a button that grows under the pointer and undoes when it's tapped. */
function Notice(props: { readonly onUndo?: () => void }) {
  // The button's ward hears its taps; its motion props stay on the element.
  const undo = w.ward()
  createEffect(undo.when("tap"), () => props.onUndo?.())
  return (
    <>
      <w.p role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: "linear" }}>
        Saved
      </w.p>
      <w.button wardRef={undo} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
        Undo
      </w.button>
    </>
  )
}

/** Renders `ui` under the provider, as the app has it, and takes it away after the test. */
const show = (ui: () => JSX.Element) => {
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(
    () => (
      <WardicProvider env={DomLive}>
        {ui()}
      </WardicProvider>
    ),
    host,
  )
  onTestFinished(() => {
    dispose()
    host.remove()
  })
  return host
}

// Wardic draws on animation frames, which fake timers fake too: the test moves time itself.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("fades the notice in", async () => {
  const notice = show(() => <Notice />).querySelector<HTMLElement>("[role=status]")!
  expect(notice.style.opacity).toBe("0")
  await vi.advanceTimersByTimeAsync(100)
  expect(Number(notice.style.opacity)).toBeCloseTo(0.5, 1)
  await vi.advanceTimersByTimeAsync(150)
  expect(notice.style.opacity).toBe("1")
})

it("grows the button under the pointer", async () => {
  const button = show(() => <Notice />).querySelector("button")!
  button.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(button.style.transform).toBe("scale(1.1)")
})

it("undoes when the button is tapped", async () => {
  const onUndo = vi.fn()
  const button = show(() => <Notice onUndo={onUndo} />).querySelector("button")!
  button.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", isPrimary: true, button: 0, bubbles: true }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(button.style.transform).toBe("scale(0.95)")
  button.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", isPrimary: true, button: 0, bubbles: true }))
  await vi.advanceTimersByTimeAsync(20)
  expect(onUndo).toHaveBeenCalledOnce()
})

it("shows the notice at once with the animations skipped", async () => {
  const host = show(() => (
    <WardicConfig skipAnimations>
      <Notice />
    </WardicConfig>
  ))
  await vi.advanceTimersByTimeAsync(20)
  expect(host.querySelector<HTMLElement>("[role=status]")!.style.opacity).toBe("1")
})
