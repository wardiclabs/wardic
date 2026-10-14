// A scroll root switching is a change of frame, not a move (#7, ADR-0012 *Amendment (#7)*), in real
// paint, the page scrolled 300px. Before #7 a `layoutScroll` container switching to or from
// `position: fixed` in place flew 292px and back, its child with it (Motion's flies on the way back
// only), and a plain bar's `position` was read once, so after it went fixed a later scroll threw
// what's inside it.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
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
/** `read` just after each of the next `n` painted frames. */
const afterEachPaint = <A,>(read: () => A, n: number): Promise<Array<A>> =>
  new Promise((resolve) => {
    const out: Array<A> = []
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      out.push(read())
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })
const topOf = (el: Element): number => el.getBoundingClientRect().top

for (const startsFixed of [false, true]) {
  it(`RS1: a layoutScroll container switching ${startsFixed ? "back from" : "to"} fixed in place, page scrolled: nothing moves (#7)`, async () => {
    const [fixed, setFixed] = createSignal(startsFixed)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ height: "3000px", position: "relative" }}>
          <wardic.div
            data-box
            layoutScroll
            layoutDependency={fixed()}
            style={{ position: fixed() ? "fixed" : "absolute", top: fixed() ? "0px" : "300px", left: "40px", width: "200px", height: "100px", overflow: "auto" }}
          >
            <wardic.div data-c layout layoutDependency={fixed()} style={{ position: "absolute", top: "20px", left: "20px", width: "60px", height: "40px" }} />
          </wardic.div>
        </div>
      </WardicProvider>
    ))
    await atRest()
    window.scrollTo(0, 300)
    await atRest()
    const box = container.querySelector("[data-box]")!
    const c = container.querySelector("[data-c]")!
    const [box0, c0] = [topOf(box), topOf(c)]
    setFixed(!fixed())
    for (const [i, f] of (await afterEachPaint(() => [topOf(box) - box0, topOf(c) - c0], 6)).entries()) {
      expect(Math.abs(f[0]!), `frame ${i}: the container`).toBeLessThan(0.5)
      expect(Math.abs(f[1]!), `frame ${i}: its child`).toBeLessThan(0.5)
    }
  })
}

it("RS2: a nav bar goes fixed, the page scrolls on, and its indicator moves to the next tab from where it's drawn (#7)", async () => {
  const [fixed, setFixed] = createSignal(false)
  const [tab, setTab] = createSignal(0)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ height: "3000px", position: "relative" }}>
        {/* A plain bar, not a node: its `position` used to be read once. */}
        <div data-bar style={{ position: fixed() ? "fixed" : "absolute", top: fixed() ? "0px" : "300px", left: "0px", width: "400px", height: "48px" }}>
          <wardic.div
            data-indicator
            layout
            layoutDependency={`${tab()}-${fixed()}`}
            style={{ position: "absolute", top: "40px", left: `${20 + tab() * 100}px`, width: "80px", height: "4px", background: "teal" }}
          />
        </div>
      </div>
    </WardicProvider>
  ))
  await atRest()
  window.scrollTo(0, 300)
  await atRest()
  setFixed(true)
  await atRest()
  // Fixed now: the page scrolls on under it.
  window.scrollTo(0, 700)
  await atRest()
  const indicator = container.querySelector("[data-indicator]")!
  const top0 = topOf(indicator)
  const left0 = indicator.getBoundingClientRect().left
  setTab(1)
  const flight = await afterEachPaint(() => ({ dy: topOf(indicator) - top0, dx: indicator.getBoundingClientRect().left - left0 }), 4)
  for (const [i, f] of flight.entries()) expect(Math.abs(f.dy), `frame ${i}: on the bar`).toBeLessThan(0.5)
  expect(Math.abs(flight[0]!.dx), "it goes on from where it's drawn").toBeLessThanOrEqual(Math.abs(flight[1]!.dx - flight[0]!.dx) + 1)
})
