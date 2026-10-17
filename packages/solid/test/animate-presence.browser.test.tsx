// AnimatePresence tests in a REAL browser. The old happy-dom version hand-drove
// rAF and asserted the exit at a calibrated frame count; here the exit spring
// runs in real time. <AnimatePresence> drives the exit on the RETAINED DOM node
// via the Renderer's commit sink, so we read the leaving node's real
// `style.opacity` and poll for: stays connected mid-exit, passes through, then is
// removed on settle.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { createSignal, Show } from "solid-js"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Option from "effect/Option"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const trackedNode = (container: HTMLElement): HTMLElement | undefined => {
  const node = container.querySelector("[data-presence]")
  return Option.getOrUndefined(Option.liftPredicate(node, (n): n is HTMLElement => n instanceof HTMLElement))
}

describe("AnimatePresence — single child, parent-driven exit", () => {
  it("(a) animates the child IN, then drives its exit on the retained node before removal", async () => {
    const [visible, setVisible] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))

    const entering = trackedNode(container)
    expect(entering).toBeInstanceOf(HTMLElement)
    expect(Number(entering!.style.opacity)).toBe(0) // seeded at initial

    await until(() => Number(trackedNode(container)!.style.opacity) >= 0.99)
    expect(Number(trackedNode(container)!.style.opacity)).toBeCloseTo(1, 1)

    // Flip visible false: the <Show> disposes the child owner, but AnimatePresence
    // RETAINS the node and drives the exit on it.
    const leaving = trackedNode(container)!
    setVisible(false)

    let sawMidConnected = false
    await until(() => {
      if (leaving.isConnected) {
        const v = Number(leaving.style.opacity)
        if (v > 0.02 && v < 0.95) sawMidConnected = true
      }
      return !leaving.isConnected // poll until removed
    })
    expect(sawMidConnected).toBe(true) // stayed mounted + faded THROUGH before removal
    expect(leaving.isConnected).toBe(false)
    expect(trackedNode(container)).toBeUndefined()
  })

  it("(b) removes the child immediately when no exit prop is set", async () => {
    const [visible, setVisible] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))

    const leaving = trackedNode(container)!
    expect(leaving).toBeInstanceOf(HTMLElement)
    await until(() => Number(trackedNode(container)!.style.opacity) >= 0.99)

    // No exit target -> immediate removal on leave (no exit animation to await).
    setVisible(false)
    await until(() => !leaving.isConnected)
    expect(leaving.isConnected).toBe(false)
    expect(trackedNode(container)).toBeUndefined()
  })

  it("(c) re-entry mounts a fresh node seeded at initial", async () => {
    const [visible, setVisible] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))

    const first = trackedNode(container)!
    await until(() => Number(first.style.opacity) >= 0.99)
    expect(Number(first.style.opacity)).toBeCloseTo(1, 1)

    // Leave: drive the exit fully so the first node is removed.
    setVisible(false)
    await until(() => !first.isConnected)
    expect(first.isConnected).toBe(false)

    // Re-enter: a FRESH node mounts, seeded at the initial (opacity 0).
    setVisible(true)
    await raf()
    const second = trackedNode(container)
    expect(second).toBeInstanceOf(HTMLElement)
    expect(second).not.toBe(first)
    expect(Number(second!.style.opacity)).toBeLessThan(0.3) // seeded near initial

    // ...and it animates back up toward 1.
    await until(() => Number(trackedNode(container)!.style.opacity) >= 0.99)
    expect(Number(trackedNode(container)!.style.opacity)).toBeCloseTo(1, 1)
  })
})
