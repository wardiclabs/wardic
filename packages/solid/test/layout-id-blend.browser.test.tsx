// A handover blends the twin's look into the new Lead's (#166, ADR-0010 *Amendment (#166)*), in real
// paint: a rounded (20px), tilted (20°) twin hands over to a square, straight one. In a crossfade
// both twins are drawn with the blended radius and rotation; in a Switch the new twin starts with
// the leaver's look, its opacity (0.4) included. Before #166 the Lead was square and straight from
// its first frame, the Follower kept its own look, and a Switch popped.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const A: JSX.CSSProperties = { position: "absolute", left: "20px", top: "40px", width: "80px", height: "40px", background: "teal", "border-radius": "20px" }
const B: JSX.CSSProperties = { position: "absolute", left: "300px", top: "40px", width: "80px", height: "40px", background: "orange" }
const TILT = { initial: { rotate: 20 }, animate: { rotate: 20 } } as const

type Look = { readonly radius: number; readonly rotate: number; readonly opacity: number }
/** `el`'s top-left radius as painted (its computed px times its x scale), rotation in degrees, and opacity. */
const lookOf = (el: HTMLElement): Look => {
  const cs = getComputedStyle(el)
  const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform)
  return { radius: Number.parseFloat(cs.borderTopLeftRadius) * Math.hypot(m.a, m.b), rotate: (Math.atan2(m.b, m.a) * 180) / Math.PI, opacity: Number(cs.opacity) }
}
const atRest = async (): Promise<void> => {
  for (let i = 0; i < 90; i++) await raf()
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
/** The start goes on from `before`: its first value no further from it than its next step. */
const expectGoesOnFrom = (before: number, [first, second]: ReadonlyArray<number>, what: string) => {
  expect(Math.abs(first! - before), `${what}: jump at the start (next step ${Math.abs(second! - first!).toFixed(2)})`).toBeLessThanOrEqual(
    Math.abs(second! - first!) + 0.5,
  )
}

it("blend (BL1): a crossfade draws both twins with the blended radius and rotation (#166)", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "120px" }}>
        <wardic.div data-a layoutId="bl1" {...TILT} style={A} />
        <Show when={open()}>
          <wardic.div data-b layoutId="bl1" style={B} />
        </Show>
      </div>
    </WardicProvider>
  ))
  await atRest()
  const a = container.querySelector("[data-a]") as HTMLElement
  const seen = lookOf(a)
  setOpen(true)
  const flight = await afterEachPaint(() => ({ a: lookOf(a), b: lookOf(container.querySelector("[data-b]") as HTMLElement) }), 90)
  expectGoesOnFrom(seen.radius, flight.map((f) => f.b.radius), "B's radius")
  expectGoesOnFrom(seen.rotate, flight.map((f) => f.b.rotate), "B's rotation")
  for (const [i, f] of flight.entries()) {
    if (f.a.opacity < 0.01) continue
    expect(Math.abs(f.a.rotate - f.b.rotate), `frame ${i}: the Follower's rotation`).toBeLessThan(0.5)
    expect(Math.abs(f.a.radius - f.b.radius), `frame ${i}: the Follower's radius`).toBeLessThan(0.5)
  }
  const rest = flight.at(-1)!.b
  expect(rest.radius, "B's own radius").toBeCloseTo(0, 0)
  expect(rest.rotate, "B's own rotation").toBeCloseTo(0, 0)
})

it("blend (BL2): a Switch starts with the leaver's look, opacity included, and eases into its own (#166)", async () => {
  const [which, setWhich] = createSignal("a")
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "120px" }}>
        <Show when={which() === "a"} fallback={<wardic.div data-b layoutId="bl2" style={B} />}>
          <wardic.div data-a layoutId="bl2" {...TILT} style={{ ...A, opacity: 0.4 }} />
        </Show>
      </div>
    </WardicProvider>
  ))
  await atRest()
  const seen = lookOf(container.querySelector("[data-a]") as HTMLElement)
  setWhich("b")
  const flight = await afterEachPaint(() => lookOf(container.querySelector("[data-b]") as HTMLElement), 90)
  expectGoesOnFrom(seen.radius, flight.map((f) => f.radius), "B's radius")
  expectGoesOnFrom(seen.rotate, flight.map((f) => f.rotate), "B's rotation")
  expectGoesOnFrom(seen.opacity, flight.map((f) => f.opacity), "B's opacity")
  const rest = flight.at(-1)!
  expect(rest.radius).toBeCloseTo(0, 0)
  expect(rest.rotate).toBeCloseTo(0, 0)
  expect(rest.opacity, "its own opacity at rest").toBeCloseTo(1, 2)
})
