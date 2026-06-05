// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { ErrorBoundary, type JSX } from "solid-js"
import { wardic, WardicProvider } from "@wardic/solid"

/**
 * Deterministic rAF + macrotask settle harness — identical strategy to
 * use-wardic.test.tsx / wardic-create.test.tsx: BOTH the Clock's rAF loop and the
 * gate's flush rAF are hand-driven, and forked Effect fibers drain on a real
 * macrotask turn. The commit sink runs `Renderer.commit(target, patch)` inside
 * the gate's flush, writing the projected style straight onto the forwarded
 * element — so assertions read the forwarded element's `style`.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
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
    fireFrame(i * 16)
    await tick()
  }
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

describe("wardic.create(Component) — commit sink drives the forwarded element", () => {
  it("animates the forwarded element's opacity 0 -> 1 across driven frames", async () => {
    let el: HTMLElement | undefined
    const Card = (p: { ref?: (el: HTMLElement) => void }): JSX.Element => (
      <div
        ref={(node) => {
          el = node
          p.ref?.(node)
        }}
      >
        card
      </div>
    )
    const W = wardic.create(Card)

    render(() => (
      <WardicProvider env={DomLive}>
        <W initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      </WardicProvider>
    ))

    // The forwarded element exists; the commit sink drives it post-mount.
    expect(el).toBeInstanceOf(HTMLElement)

    await settle()
    await drive(8)
    const mid = opacityOf(el!)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })

  it("merges a user ref passed to the wrapper alongside the spine's setter", () => {
    let userSpyEl: HTMLElement | undefined
    const userSpy = vi.fn<(node: HTMLElement) => void>((node) => {
      userSpyEl = node
    })
    const Card = (p: { ref?: (el: HTMLElement) => void }): JSX.Element => <div ref={p.ref}>card</div>
    const W = wardic.create(Card)

    render(() => (
      <WardicProvider env={DomLive}>
        <W ref={userSpy} initial={{ opacity: 0.4 }} />
      </WardicProvider>
    ))

    // The user's ref was invoked with the live forwarded element (merged via
    // mergeRefs alongside the spine's internal setter).
    expect(userSpy).toHaveBeenCalledTimes(1)
    expect(userSpyEl).toBeInstanceOf(HTMLElement)
  })

  it("throws the actionable ADR-0008 error when the component does not forward its ref", () => {
    const Bad = (): JSX.Element => <div>bad</div>
    const W = wardic.create(Bad as () => JSX.Element)

    // The non-forwarding component surfaces the clear dev error on mount.
    let captured: Error | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <ErrorBoundary
          fallback={(err) => {
            captured = err as Error
            return <div>error</div>
          }}
        >
          <W initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        </ErrorBoundary>
      </WardicProvider>
    ))

    expect(captured).toBeInstanceOf(Error)
    expect(captured!.message).toMatch(/did not forward its ref/)
    expect(captured!.message).toMatch(/props\.ref/)
  })

  it("reacts to whileHover via pointerenter on the forwarded element", async () => {
    let el: HTMLElement | undefined
    const Card = (p: { ref?: (el: HTMLElement) => void }): JSX.Element => (
      <div
        ref={(node) => {
          el = node
          p.ref?.(node)
        }}
      >
        card
      </div>
    )
    const W = wardic.create(Card)

    render(() => (
      <WardicProvider env={DomLive}>
        <W initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))

    // Settle at the base 0.2 first.
    await settle()
    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(0.2, 1)

    // pointerenter -> hovered() flips; the recognizer attaches asynchronously,
    // so re-dispatch inside waitFor (draining the scheduler) until it moves.
    await waitFor(
      async () => {
        el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }))
        await drive(10)
        expect(opacityOf(el!)).toBeGreaterThan(0.2)
      },
      { timeout: 2000 },
    )
    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})
