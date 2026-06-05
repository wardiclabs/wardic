// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { createSignal, Show } from "solid-js"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"

/**
 * Deterministic rAF + macrotask settle harness — identical strategy to
 * use-wardic.test.tsx / wardic-component.test.tsx: BOTH the Clock's rAF loop and
 * the gate's flush rAF are hand-driven, and forked Effect fibers drain on a real
 * macrotask turn.
 *
 * <AnimatePresence> drives the exit on the RETAINED DOM node via the Renderer's
 * commit sink, so we read the leaving node's `style.opacity` straight off the
 * container DOM (the node persists mid-exit, then is removed on settle).
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number
// A MONOTONIC absolute clock (ms), advanced ~16ms per fired frame and NEVER
// reset between drive() calls. The provider's Clock computes dt from successive
// timestamps with a SHARED `lastTime` across every subscriber — so a fiber that
// subscribes late (the parent-driven EXIT) must still see a positive dt. A naive
// `i * 16` per drive() resets to 0 and feeds the freshly-subscribed exit spring a
// large NEGATIVE dt, stalling it. The monotonic clock avoids that.
let clock: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
  clock = 0
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const fireFrame = (t: number): void => {
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(t)
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const settle = (): Promise<void> => tick()

const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    clock += 16
    fireFrame(clock)
    await tick()
  }
}

/** The single tracked <wardic.div> node within the container (or undefined). */
const trackedNode = (container: HTMLElement): HTMLElement | undefined => {
  const node = container.querySelector("[data-presence]")
  return node instanceof HTMLElement ? node : undefined
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

    // Mounts + animates opacity 0 -> 1.
    const entering = trackedNode(container)
    expect(entering).toBeInstanceOf(HTMLElement)
    expect(Number(entering!.style.opacity)).toBe(0)

    await settle()
    await drive(80)
    expect(Number(trackedNode(container)!.style.opacity)).toBeCloseTo(1, 1)

    // Capture the live node, then flip visible false. The <Show> disposes the
    // child's owner, but <AnimatePresence> retains the node and drives the exit.
    const leaving = trackedNode(container)!
    setVisible(false)

    // Mid-exit: the node STAYS in the DOM and opacity decreases toward 0.
    await settle()
    await drive(6)
    expect(leaving.isConnected).toBe(true)
    const mid = Number(leaving.style.opacity)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)

    // After enough frames the exit settles and the node is REMOVED.
    await drive(120)
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
    await settle()
    await drive(40)

    // No exit target -> immediate removal on leave (no exit animation).
    setVisible(false)
    await tick()
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
    await settle()
    await drive(80)
    expect(Number(first.style.opacity)).toBeCloseTo(1, 1)

    // Leave: drive the exit fully so the first node is removed.
    setVisible(false)
    await settle()
    await drive(160)
    expect(first.isConnected).toBe(false)

    // Re-enter: a FRESH node mounts, seeded at the initial (opacity 0).
    setVisible(true)
    const second = trackedNode(container)
    expect(second).toBeInstanceOf(HTMLElement)
    expect(second).not.toBe(first)
    expect(Number(second!.style.opacity)).toBe(0)

    // ...and it animates back up toward 1.
    await settle()
    await drive(80)
    expect(Number(trackedNode(container)!.style.opacity)).toBeCloseTo(1, 1)
  })
})
