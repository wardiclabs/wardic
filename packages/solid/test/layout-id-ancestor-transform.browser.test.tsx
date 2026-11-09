// A twin's flight follows Wardic's own ancestor transforms each frame (#137, ADR-0012 *Amendment
// (#137)*), in real paint: a thumbnail's twin crossfades into a modal that scales in from 0.8. Before
// #137, with a modal that isn't a node, the Follower drifted up to 31.6px off its Lead; with a `layout`
// modal, the Lead started 82px off its twin. Motion starts 80px off either way.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
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
/**
 * `act` just after a painted frame, then `read` just after each of the next `n`: the first read is the
 * first frame painted after `act`, however busy the page is.
 */
const paintsAfter = <A,>(act: () => void, read: () => A, n: number): Promise<Array<A>> =>
  new Promise((resolve) => {
    const out: Array<A> = []
    let acted = false
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      if (acted) out.push(read())
      else act()
      acted = true
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })

// MS3–MS4: the projection is already running (another layout node moving) when the modal's scale
// starts, so its run was on the Frame loop first. It steps in the loop's last lane, after the modal's,
// and reads the scale that frame paints (ADR-0027 *Amendment (#137)*). In the loop's add order, it
// read the frame before's: the Follower up to 2.5px off in the lab.
for (const [layout, busy] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const) {
  const n = 1 + Number(layout) + 2 * Number(busy)
  const busyText = Bool.match(busy, { onTrue: () => ", the projection already running", onFalse: () => "" })
  it(`MS${n}: a twin crossfades into a ${Bool.match(layout, { onTrue: () => "layout ", onFalse: () => "" })}modal scaling in from 0.8${busyText}: it starts on its twin, the Follower on it every frame (#137)`, async () => {
    const [open, setOpen] = createSignal(false)
    const [moved, setMoved] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "500px" }}>
          <wardic.div
            layout
            layoutDependency={moved()}
            transition={{ type: "spring", stiffness: 40, damping: 20 }}
            style={{ position: "absolute", left: Bool.match(moved(), { onTrue: () => "400px", onFalse: () => "0px" }), top: "460px", width: "20px", height: "20px", background: "gray" }}
          />
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
    if (busy) {
      setMoved(true)
      for (let i = 0; i < 4; i++) await raf()
    }
    const flight = await paintsAfter(
      () => setOpen(true),
      () => ({ lead: rectOf(container.querySelector("[data-big]")!), follower: rectOf(thumb), shows: Number(getComputedStyle(thumb).opacity) > 0.01 }),
      40,
    )
    expect(apart(flight[0]!.lead, seen), "the Lead starts on its twin").toBeLessThanOrEqual(apart(flight[1]!.lead, flight[0]!.lead) + 1)
    for (const [i, f] of flight.entries()) if (f.shows) expect(apart(f.follower, f.lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.75)
  })
}

// MS5 (#680, Q9): the modal scales in from 0.8 as its twin flies in (MS1), and a callback in the Frame
// loop's tick (another element's landing) retargets that scale mid-flight. Its new leg takes its Late
// step after the coordinator stepped in that tick, so the coordinator steps again at dt 0 and reads the
// scale that frame paints (ADR-0027 *Amendment (#680)*). Without that step the Follower is drawn a step
// behind for a frame.
it("MS5: the modal's scale retargeted in the Late window mid-flight: the Follower on the Lead every frame (#680)", async () => {
  const [open, setOpen] = createSignal(false)
  const [shrunk, setShrunk] = createSignal(false)
  const [go, setGo] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "500px" }}>
        <wardic.div
          animate={{ x: Bool.match(go(), { onTrue: () => 40, onFalse: () => 0 }) }}
          transition={{ type: "tween", duration: 0.1 }}
          onAnimationComplete={() => {
            if (go()) setShrunk(true)
          }}
          style={{ position: "absolute", left: "0px", top: "460px", width: "20px", height: "20px", background: "gray" }}
        />
        <wardic.div data-thumb layoutId="ms5" style={{ position: "absolute", left: "20px", top: "300px", width: "60px", height: "40px", background: "teal" }} />
        <Show when={open()}>
          <wardic.div
            initial={{ scale: 0.8 }}
            animate={{ scale: Bool.match(shrunk(), { onTrue: () => 0.6, onFalse: () => 1 }) }}
            transition={{ type: "spring", stiffness: 60, damping: 20 }}
            style={{ position: "absolute", left: "300px", top: "100px", width: "300px", height: "240px", background: "#eee" }}
          >
            <wardic.div data-big layoutId="ms5" transition={{ type: "spring", stiffness: 60, damping: 20 }} style={{ position: "absolute", left: "50px", top: "40px", width: "200px", height: "150px", background: "orange" }} />
          </wardic.div>
        </Show>
      </div>
    </WardicProvider>
  ))
  await atRest()
  const thumb = container.querySelector("[data-thumb]") as HTMLElement
  const flight = await paintsAfter(
    () => {
      setOpen(true)
      setGo(true)
    },
    () => ({ lead: rectOf(container.querySelector("[data-big]")!), follower: rectOf(thumb), shows: Number(getComputedStyle(thumb).opacity) > 0.01 }),
    40,
  )
  for (const [i, f] of flight.entries()) if (f.shows) expect(apart(f.follower, f.lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.75)
})
