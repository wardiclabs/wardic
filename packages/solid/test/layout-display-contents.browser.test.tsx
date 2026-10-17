// A `display: contents` layout node has no box (#9, ADR-0009 *Amendment (#9)*), in real paint. Its
// rect is 0x0 at the viewport's origin, so with the page scrolled between passes it read as a move
// the scroll's length. CSS applies no transform to it, but the node inside it was corrected for that
// move anyway: before #9, scrolled 300px, the child jumped 292px down on its first frame.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(() => {
  window.scrollTo(0, 0)
  cleanup()
})

const atRest = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) await raf()
}

/** `el`'s top-left, offset from `before`, just after each of the next `n` painted frames. */
const offsetsAfterPaint = (el: Element, before: DOMRect, n: number): Promise<Array<{ readonly dx: number; readonly dy: number }>> =>
  new Promise((resolve) => {
    const out: Array<{ readonly dx: number; readonly dy: number }> = []
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      const r = el.getBoundingClientRect()
      out.push({ dx: r.left - before.left, dy: r.top - before.top })
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })

it("SC1: under a display: contents layout node, the page scrolled, a child moves from where it was (#9)", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ height: "3000px", position: "relative" }}>
        <wardic.div layout style={{ display: "contents" }}>
          <wardic.div
            data-c
            layout
            layoutDependency={moved()}
            style={{ position: "absolute", top: "600px", left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "20px" }), width: "60px", height: "40px", background: "teal" }}
          />
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  await atRest()
  window.scrollTo(0, 300)
  await atRest()
  const c = container.querySelector("[data-c]") as HTMLElement
  const before = c.getBoundingClientRect()
  setMoved(true)
  const flight = await offsetsAfterPaint(c, before, 4)
  for (const [i, f] of flight.entries()) expect(Math.abs(f.dy), `frame ${i}: no jump on y`).toBeLessThan(1)
  expect(Math.abs(flight[0]!.dx), "x goes on from where it was").toBeLessThanOrEqual(Math.abs(flight[1]!.dx - flight[0]!.dx) + 1)
  await atRest()
  expect(c.getBoundingClientRect().left - before.left, "at its new place").toBeCloseTo(180, 0)
})
