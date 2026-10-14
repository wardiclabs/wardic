// A twin's flight follows Wardic's own ancestor transforms each frame (#137, ADR-0012 *Amendment
// (#137)*), in real paint: a thumbnail's twin crossfades into a modal that scales in from 0.8. Before
// #137, with a modal that isn't a node, the Follower drifted up to 31.6px off its Lead; with a `layout`
// modal, the Lead started 82px off its twin. Motion starts 80px off either way.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { createSignal, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const SPRING = { type: "spring", stiffness: 170, damping: 26 } as const
type Rect = { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
const rectOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { l: r.left, t: r.top, r: r.right, b: r.bottom }
}
const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b))
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

for (const layout of [false, true]) {
  it(`MS${layout ? 2 : 1}: a twin crossfades into a ${layout ? "layout " : ""}modal scaling in from 0.8: it starts on its twin, the Follower on it every frame (#137)`, async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "500px" }}>
          <wardic.div data-thumb layoutId="ms" style={{ position: "absolute", left: "20px", top: "300px", width: "60px", height: "40px", background: "teal" }} />
          <Show when={open()}>
            <wardic.div
              layout={layout}
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={SPRING}
              style={{ position: "absolute", left: "300px", top: "100px", width: "300px", height: "240px", background: "#eee" }}
            >
              <wardic.div data-big layoutId="ms" style={{ position: "absolute", left: "50px", top: "40px", width: "200px", height: "150px", background: "orange" }} />
            </wardic.div>
          </Show>
        </div>
      </WardicProvider>
    ))
    await atRest()
    const thumb = container.querySelector("[data-thumb]") as HTMLElement
    const seen = rectOf(thumb)
    setOpen(true)
    const flight = await afterEachPaint(
      () => ({ lead: rectOf(container.querySelector("[data-big]")!), follower: rectOf(thumb), shows: Number(getComputedStyle(thumb).opacity) > 0.01 }),
      40,
    )
    expect(apart(flight[0]!.lead, seen), "the Lead starts on its twin").toBeLessThanOrEqual(apart(flight[1]!.lead, flight[0]!.lead) + 1)
    for (const [i, f] of flight.entries()) if (f.shows) expect(apart(f.follower, f.lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.75)
  })
}
