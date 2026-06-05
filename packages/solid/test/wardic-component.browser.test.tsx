// `wardic.create(Component)` HOC in a REAL browser. The original drove a
// hand-stubbed rAF clock under happy-dom; here the engine animates in REAL time,
// so the retarget assertions POLL real frames for a settle/INVARIANT instead of
// reading an exact value at a calibrated frame count. Ref-forwarding and the
// ADR-0008 non-forwarding error are synchronous and assert as before.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DomLive } from "@wardic/dom"
import { ErrorBoundary, type JSX } from "solid-js"
import { wardic, WardicProvider } from "@wardic/solid"
import { opacityOf, until } from "./browser-helpers.ts"

afterEach(cleanup)

describe("wardic.create(Component) — commit sink drives the forwarded element", () => {
  it("animates the forwarded element's opacity 0 -> 1 over real frames", async () => {
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

    let sawMid = false
    await until(() => {
      const o = opacityOf(el!)
      if (o > 0 && o < 1) sawMid = true
      return o >= 0.99
    })
    expect(sawMid).toBe(true) // animated THROUGH (not an instant jump)
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
    await until(() => Math.abs(opacityOf(el!) - 0.2) < 0.02)
    expect(opacityOf(el!)).toBeCloseTo(0.2, 1)

    // pointerenter -> hovered() flips; the recognizer attaches asynchronously,
    // so re-dispatch each frame until the opacity departs the base toward 1.
    await until(() => {
      el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }))
      return opacityOf(el!) > 0.25
    })
    expect(opacityOf(el!)).toBeGreaterThan(0.2)

    await until(() => opacityOf(el!) >= 0.99)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})
