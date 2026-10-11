// `use:ward` directive wiring in a REAL browser. The original drove a hand-stubbed
// rAF clock under happy-dom; here the engine animates in REAL time (real rAF +
// real Effect scheduling), so instead of asserting exact opacity at a calibrated
// frame count we POLL real frames and assert ROBUST INVARIANTS: the spring
// departs its seed, eventually settles, the user's inline style coexists, hover
// raises it, and unmount stops further writes.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
// IMPORTANT: `ward` MUST be imported at the top so `use:ward` resolves —
// vite-plugin-solid compiles `use:ward={cfg}` into a bare `ward(el, () => cfg)`
// call, and the import retains the symbol (no tree-shake). See directive.ts.
import { ward, WardicProvider } from "@wardic/solid"
import { opacityOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

describe("use:ward — animate (commit sink)", () => {
  it("animates the element's style.opacity 0 -> 1 over real frames", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    ))

    // use:ward is CLIENT-ONLY: the commit happens post-mount. The spring departs
    // the seeded 0 and climbs into the open range...
    let sawMid = false
    await until(() => {
      const o = opacityOf(el!)
      if (o > 0 && o < 1) sawMid = true
      return o >= 0.99
    })
    expect(sawMid).toBe(true) // animated THROUGH (not an instant jump)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })

  it("preserves the user's inline style alongside the animated keys", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    ))

    // The user's inline style is on the element from the first render.
    expect(el!.style.height).toBe("100px")

    // The commit sink writes only the animated key (opacity) onto el.style; the
    // inline height:100px coexists across the whole animation.
    await until(() => opacityOf(el!) > 0)
    expect(el!.style.height).toBe("100px")

    await until(() => opacityOf(el!) >= 0.99)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
    expect(el!.style.height).toBe("100px")
  })
})

describe("use:ward — whileHover", () => {
  it("animates toward whileHover on pointerenter", async () => {
    let el: HTMLDivElement | undefined
    // Clear of (5, 5), where the real-mouse files park the page's one mouse after each test:
    // a file running beside this one would hover the element as it mounts, and since #73 its
    // first painted frame is the hover's first step, never the base (ADR-0033).
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ "padding-top": "40px" }}>
          <div
            ref={(node: HTMLDivElement) => {
              el = node
            }}
            use:ward={{ initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileHover: { opacity: 1 } }}
            style={{ height: "100px" }}
          />
        </div>
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

describe("use:ward — teardown", () => {
  it("unmount tears down: no further style writes after unmount", async () => {
    let el: HTMLDivElement | undefined
    const dispose = render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    )).unmount

    // Advance until the spring is mid-flight (writes are happening).
    await until(() => {
      const o = opacityOf(el!)
      return o > 0 && o < 0.9
    })
    const moving = opacityOf(el!)
    expect(moving).toBeGreaterThan(0)
    expect(moving).toBeLessThan(1)

    // Unmount: spine fibers interrupt + gate unregister fire via onCleanup.
    dispose()
    const atUnmount = el!.style.opacity

    // Firing many more frames must not advance the element's opacity.
    for (let i = 0; i < 40; i++) await raf()
    expect(el!.style.opacity).toBe(atUnmount)
  })
})

// Reference `ward` directly so static analysis sees the import as used even if a
// toolchain fails to recognize the `use:ward` compilation (belt-and-suspenders).
void ward
