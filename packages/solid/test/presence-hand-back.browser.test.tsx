// A leaving `<AnimatePresence>` child that isn't a twin hands back the twins inside it (#181, ADR-0010
// *Amendment (#181)*), in real paint: a thumbnail twin, and an overlay wrapper holding its other twin.
// Before #181 the inner twin stayed behind (or vanished with a wrapper with no exit) while the
// thumbnail popped in alone; Motion crossfades it back, and keeps the wrapper until it has.
//
// - PH1–PH2: an opacity exit, and none: the inner twin is a Follower on the thumbnail every frame,
//   fading out as it fades in; the wrapper stays until the handover ends, as drawn with no exit.
// - PH3: an exit that scales and slides the wrapper: the Follower stays on its Lead (Q6).
// - PH4: a reopen mid-close: the closing wrapper isn't cut short, its twin follows the new Lead, and
//   the twins are never see-through.
// - PH5: the AnimatePresence unmounts mid-close: the wrapper and its twin go at once, and the
//   thumbnail lands.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
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
/** How much of `e` shows: its opacity times every ancestor's. */
const shown = (e: Element): number => {
  let o = 1
  for (let n: Element | null = e; n !== null; n = n.parentElement) o *= Number(getComputedStyle(n).opacity)
  return o
}
const THUMB: Rect = { l: 20, t: 300, r: 80, b: 340 }
const settle = async (): Promise<void> => {
  for (let i = 0; i < 90; i++) await raf()
}
/** `act` just after a painted frame, then `read` just after each of the next `n`. */
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

/** A thumbnail twin, and under presence a wrapper holding the other, with `exit`. */
const mount = (exit: Record<string, number> | undefined) => {
  const [open, setOpen] = createSignal(false)
  const [present, setPresent] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "520px" }}>
        <wardic.div data-thumb layoutId="t" transition={SPRING} style={{ position: "absolute", left: "20px", top: "300px", width: "60px", height: "40px", background: "teal" }} />
        <Show when={present()}>
          <AnimatePresence>
            <Show when={open()}>
              <wardic.div data-wrap exit={exit ?? {}} transition={SPRING} style={{ position: "absolute", left: "300px", top: "100px", width: "300px", height: "240px", background: "#eee" }}>
                <wardic.div data-big layoutId="t" transition={SPRING} style={{ position: "absolute", left: "50px", top: "40px", width: "200px", height: "150px", background: "orange" }} />
              </wardic.div>
            </Show>
          </AnimatePresence>
        </Show>
      </div>
    </WardicProvider>
  ))
  const q = (s: string): Element | null => container.querySelector(s)
  return { open: setOpen, present: setPresent, q, thumb: q("[data-thumb]")! }
}

for (const [n, exit] of [
  [1, { opacity: 0 }],
  [2, undefined],
] as const) {
  it(`PH${n}: ${exit === undefined ? "a wrapper with no exit" : "an opacity exit"}: its twin crossfades back onto the thumbnail, and it stays until the handover ends`, async () => {
    const m = mount(exit)
    await raf()
    m.open(true)
    await settle()
    const wrap = m.q("[data-wrap]")!
    const big = m.q("[data-big]")!
    const seen = await paintsAfter(
      () => m.open(false),
      () => ({
        present: wrap.isConnected,
        apart: apart(rectOf(big), rectOf(m.thumb)),
        follower: Number(getComputedStyle(big).opacity),
        wrapOpacity: Number(getComputedStyle(wrap).opacity),
        lead: Number(getComputedStyle(m.thumb).opacity),
        landing: apart(rectOf(m.thumb), THUMB),
        covers: 1 - (1 - shown(m.thumb)) * (1 - shown(big)),
      }),
      100,
    )
    const showing = seen.filter((s) => s.present && s.follower > 0.01)
    expect(showing.length, "frames the Follower shows").toBeGreaterThan(10)
    expect(Math.max(...showing.map((s) => s.apart)), "the Follower off the thumbnail, px").toBeLessThan(0.75)
    expect(seen[0]!.lead, "the thumbnail fades in from 0").toBeLessThan(0.6)
    expect(seen.some((s) => s.present && s.follower > 0.05 && s.follower < 0.95), "the inner twin fades out").toBe(true)
    expect(seen.filter((s) => s.landing > 0.5).every((s) => s.present), "the wrapper stays while the handover runs").toBe(true)
    expect(seen.at(-1)!.present, "and goes after").toBe(false)
    if (exit === undefined) {
      expect(seen.filter((s) => s.present).every((s) => s.wrapOpacity === 1), "as drawn, with no exit").toBe(true)
      expect(Math.min(...seen.filter((s) => s.present).map((s) => s.covers)), "never see-through").toBeGreaterThanOrEqual(0.98)
    }
  })
}

it("PH3: an exit that scales and slides the wrapper: the Follower inside stays on its Lead", async () => {
  const m = mount({ scale: 0.8, y: 60 })
  await raf()
  m.open(true)
  await settle()
  const wrap = m.q("[data-wrap]")!
  const big = m.q("[data-big]")!
  const seen = await paintsAfter(
    () => m.open(false),
    () => ({ present: wrap.isConnected, apart: apart(rectOf(big), rectOf(m.thumb)), follower: Number(getComputedStyle(big).opacity), wrapScale: new DOMMatrix(getComputedStyle(wrap).transform).a }),
    60,
  )
  const showing = seen.filter((s) => s.present && s.follower > 0.01)
  expect(Math.min(...showing.map((s) => s.wrapScale)), "the wrapper scales down as the Follower shows").toBeLessThan(0.95)
  expect(Math.max(...showing.map((s) => s.apart)), "the Follower off its Lead, px").toBeLessThan(0.75)
})

it("PH4: a reopen mid-close: the closing wrapper isn't cut short, its twin follows the new Lead, never see-through", async () => {
  // An exit that runs (so presence holds it as exiting) and doesn't fade (so what shows is the twins').
  const m = mount({ scale: 0.9 })
  await raf()
  m.open(true)
  await settle()
  const oldWrap = m.q("[data-wrap]")!
  const oldBig = m.q("[data-big]")!
  await paintsAfter(() => m.open(false), () => undefined, 12)
  const seen = await paintsAfter(
    () => m.open(true),
    () => {
      const bigs = Array.from(document.querySelectorAll("[data-big]"))
      const newBig = bigs.find((b) => b !== oldBig)
      return {
        oldPresent: oldWrap.isConnected,
        oldOff: newBig === undefined ? 0 : apart(rectOf(oldBig), rectOf(newBig)),
        oldShows: Number(getComputedStyle(oldBig).opacity),
        covers: 1 - [m.thumb, ...bigs].reduce((hidden, e) => hidden * (1 - shown(e)), 1),
      }
    },
    100,
  )
  expect(seen[0]!.oldPresent, "the closing wrapper isn't removed at the reopen").toBe(true)
  const following = seen.filter((s) => s.oldPresent && s.oldShows > 0.01)
  expect(following.length, "frames its twin shows after the reopen").toBeGreaterThan(3)
  expect(Math.max(...following.map((s) => s.oldOff)), "its twin off the new Lead, px").toBeLessThan(0.75)
  expect(Math.min(...seen.map((s) => s.covers)), "the twins never see-through").toBeGreaterThanOrEqual(0.98)
  expect(seen.at(-1)!.oldPresent, "it goes once its handover ends").toBe(false)
  expect(document.querySelectorAll("[data-wrap]"), "the new wrapper stays").toHaveLength(1)
})

it("PH5: the AnimatePresence unmounts mid-close: the wrapper and its twin go at once, and the thumbnail lands", async () => {
  // No exit: the wrapper is held by its handover alone, the case teardown must find too.
  const m = mount(undefined)
  await raf()
  m.open(true)
  await settle()
  const wrap = m.q("[data-wrap]")!
  await paintsAfter(() => m.open(false), () => undefined, 10)
  expect(wrap.isConnected, "closing").toBe(true)
  m.present(false)
  expect(wrap.isConnected, "gone with the presence").toBe(false)
  await settle()
  expect(apart(rectOf(m.thumb), THUMB), "the thumbnail landed, px").toBeLessThan(0.5)
  expect(Number(getComputedStyle(m.thumb).opacity)).toBe(1)
})
