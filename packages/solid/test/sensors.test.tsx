import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "@effect/vitest"
import type { DragSample } from "@wardic/core"
import { DomLive } from "@wardic/dom"
import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import {
  createDrag,
  createHover,
  createInView,
  createReducedMotion,
  createTransform,
  WardicProvider,
} from "@wardic/solid"

afterEach(cleanup)

/**
 * Render `body` (which captures a sensor accessor on `el`) inside a
 * `<WardicProvider env={DomLive}>` over a real happy-dom element. Returns the
 * element so the test can dispatch real DOM events at it.
 *
 * The element is appended to the document so listeners attached by the DOM
 * `InputSource` (and the `IntersectionObserver` happy-dom provides) see the
 * dispatched events.
 */
const renderWithProbe = (body: (el: HTMLElement) => void): HTMLElement => {
  const el = document.createElement("div")
  document.body.appendChild(el)
  function Probe() {
    body(el)
    return <div>probe</div>
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Probe />
    </WardicProvider>
  ))
  return el
}

describe("createHover", () => {
  it("flips true on pointerenter and false on pointerleave", async () => {
    let hovered: Accessor<boolean> | undefined
    const el = renderWithProbe((target) => {
      hovered = createHover(target)
    })

    expect(hovered!()).toBe(false)

    // The recognizer fiber attaches its DOM listener asynchronously (forked on
    // the runtime), so re-dispatch inside waitFor until the listener is live
    // and the signal flips — deterministic without guessing a fixed delay.
    await waitFor(() => {
      el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }))
      expect(hovered!()).toBe(true)
    })

    el.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1 }))
    await waitFor(() => expect(hovered!()).toBe(false))
  })
})

describe("createDrag", () => {
  it("emits a 'start' sample once the pointer moves past threshold", async () => {
    let sample: Accessor<DragSample | null> | undefined
    const el = renderWithProbe((target) => {
      sample = createDrag(target)
    })

    expect(sample!()).toBeNull()

    // Re-dispatch down+move inside waitFor until the recognizer fiber's DOM
    // listener is live. `down` claims the gesture (re-sends are ignored while
    // owned); the `move` to x=10 crosses the 3px threshold -> a "start" sample.
    await waitFor(() => {
      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, buttons: 1, pointerId: 1 }))
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, buttons: 1, pointerId: 1 }))
      const s = sample!()
      expect(s).not.toBeNull()
      expect(s!.phase).toBe("start")
    })
  })
})

describe("createInView", () => {
  it("subscribes and exposes a boolean (smoke)", () => {
    let visible: Accessor<boolean> | undefined
    renderWithProbe((target) => {
      visible = createInView(target)
    })
    // No intersection fires in happy-dom, so it stays at its initial false —
    // the smoke assertion is that the hook subscribed and returns a boolean.
    expect(typeof visible!()).toBe("boolean")
    expect(visible!()).toBe(false)
  })
})

describe("createReducedMotion", () => {
  it("reads a boolean from the Probe atom", () => {
    let reduced: Accessor<boolean> | undefined
    renderWithProbe(() => {
      reduced = createReducedMotion()
    })
    // happy-dom's matchMedia reports false by default; the contract under test
    // is that the atom bridge yields a boolean.
    expect(typeof reduced!()).toBe("boolean")
    expect(reduced!()).toBe(false)
  })
})

describe("createTransform", () => {
  it("maps a source signal through fn and tracks updates", () => {
    let doubled: Accessor<number> | undefined
    let setN: (n: number) => void = () => {}
    renderWithProbe(() => {
      const [n, set] = createSignal(2)
      setN = set
      doubled = createTransform(n, (x) => x * 2)
    })

    expect(doubled!()).toBe(4)
    setN(5)
    expect(doubled!()).toBe(10)
  })
})
