// `<AnimatePresence>` on Solid 2 (#209, ADR-0007), as the Solid 1 binding's presence tests pin it, in
// real frames: the leaving child's node is retained and its exit driven before it's removed.
//
// - P1–P3: the Solid 1 binding's (a)–(c): an exit on the retained node, no exit removes at once, a
//   re-entry mounts a fresh node at `initial`.
// - P4: a kept ward's spread under presence exits too, its `exit` from its config.
// - P5: an `exit` changed while the child is alive is the one it runs (the record kept current).
// - P6: `<AnimatePresence initial={false}>` holds the child present at its first render; one that
//   enters later animates in (#134, the Solid 1 binding's IF9).
// - P7: a leaving child hands back the twin inside it: the twin crossfades back onto its other twin,
//   and the child stays until the handover ends (#181, the Solid 1 binding's PH1).
// - P8: the presence unmounted mid-close: the child and its twin go at once (PH5).
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const opacityOf = (el: Element | null | undefined): number => Number((el as HTMLElement).style.opacity)
const tracked = (host: HTMLElement): HTMLElement | null => host.querySelector("[data-presence]")

/** `set(value)`, applied now. */
const flushed = <A,>(set: (value: A) => unknown) => (value: A): void => {
  set(value)
  flush()
}

describe("AnimatePresence on Solid 2: a single child, a parent-driven exit", () => {
  it("P1: animates the child in, then drives its exit on the retained node before removing it", async () => {
    const [visible, setVisible] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    expect(opacityOf(tracked(host))).toBe(0)
    await until(() => opacityOf(tracked(host)) >= 0.99)
    const leaving = tracked(host)!
    flushed(setVisible)(false)
    expect(leaving.isConnected, "retained in the flush that removed it").toBe(true)
    let sawMid = false
    await until(() => {
      if (leaving.isConnected && opacityOf(leaving) > 0.02 && opacityOf(leaving) < 0.95) sawMid = true
      return !leaving.isConnected
    })
    expect(sawMid).toBe(true)
    expect(leaving.isConnected).toBe(false)
    expect(tracked(host)).toBeNull()
  })

  it("P2: with no exit, the child is removed at once", async () => {
    const [visible, setVisible] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const leaving = tracked(host)!
    await until(() => opacityOf(leaving) >= 0.99)
    flushed(setVisible)(false)
    await until(() => !leaving.isConnected)
    expect(leaving.isConnected).toBe(false)
  })

  it("P3: a re-entry mounts a fresh node at initial", async () => {
    const [visible, setVisible] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const first = tracked(host)!
    await until(() => opacityOf(first) >= 0.99)
    flushed(setVisible)(false)
    await until(() => !first.isConnected)
    expect(first.isConnected).toBe(false)
    flushed(setVisible)(true)
    await raf()
    const second = tracked(host)
    expect(second).not.toBe(first)
    expect(opacityOf(second)).toBeLessThan(0.3)
    await until(() => opacityOf(tracked(host)) >= 0.99)
    expect(opacityOf(tracked(host))).toBeCloseTo(1, 1)
  })

  it("P4: a kept ward's spread exits too, its exit from its config", async () => {
    const [visible, setVisible] = createSignal(true)
    const Card = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })
      return <div data-presence {...card} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <Card />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const leaving = tracked(host)!
    await until(() => opacityOf(leaving) >= 0.99)
    flushed(setVisible)(false)
    let sawMid = false
    await until(() => {
      if (leaving.isConnected && opacityOf(leaving) > 0.02 && opacityOf(leaving) < 0.95) sawMid = true
      return !leaving.isConnected
    })
    expect(sawMid).toBe(true)
    expect(leaving.isConnected).toBe(false)
  })

  it("P5: an exit changed while the child is alive is the one it runs", async () => {
    const [visible, setVisible] = createSignal(true)
    const [far, setFar] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence animate={{ x: 0 }} exit={{ x: Bool.match(far(), { onTrue: () => 200, onFalse: () => 20 }) }} transition={{ type: "tween", duration: 0.3 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const leaving = tracked(host)!
    await raf()
    flushed(setFar)(true)
    flushed(setVisible)(false)
    let furthest = 0
    await until(() => {
      const x = new DOMMatrix(getComputedStyle(leaving).transform).e
      furthest = Math.max(furthest, x)
      return !leaving.isConnected
    })
    expect(furthest, "it ran the exit set after mount").toBeGreaterThan(150)
  })

  it("P6: initial={false} holds the child present at its first render; one that enters later animates in", async () => {
    const [visible, setVisible] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence initial={false}>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    expect(opacityOf(tracked(host)), "the first render's child starts at its animate").toBe(1)
    const first = tracked(host)!
    flushed(setVisible)(false)
    await until(() => !first.isConnected)
    flushed(setVisible)(true)
    expect(opacityOf(tracked(host)), "a later one starts at its initial").toBe(0)
    await until(() => opacityOf(tracked(host)) >= 0.99)
    expect(opacityOf(tracked(host))).toBeCloseTo(1, 1)
  })
})

const SPRING = { type: "spring", stiffness: 170, damping: 26 } as const
type Rect = { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
const rectOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { l: r.left, t: r.top, r: r.right, b: r.bottom }
}
const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 90; i++) await raf()
}

/** A thumbnail twin, and under presence a wrapper holding the other, with no exit. */
const twins = () => {
  const [open, setOpen] = createSignal(false)
  const [present, setPresent] = createSignal(true)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "520px" }}>
        <wardic.div data-thumb layoutId="t" transition={SPRING} style={{ position: "absolute", left: "20px", top: "300px", width: "60px", height: "40px", background: "teal" }} />
        <Show when={present()}>
          <AnimatePresence>
            <Show when={open()}>
              <wardic.div data-wrap transition={SPRING} style={{ position: "absolute", left: "300px", top: "100px", width: "300px", height: "240px", background: "#eee" }}>
                <wardic.div data-big layoutId="t" transition={SPRING} style={{ position: "absolute", left: "50px", top: "40px", width: "200px", height: "150px", background: "orange" }} />
              </wardic.div>
            </Show>
          </AnimatePresence>
        </Show>
      </div>
    </WardicProvider>
  ))
  const q = (s: string): Element | null => host.querySelector(s)
  return { open: flushed(setOpen), present: flushed(setPresent), q, thumb: q("[data-thumb]")! }
}

describe("AnimatePresence on Solid 2: twins handed back (#181)", () => {
  it("P7: the leaving wrapper's twin crossfades back onto the thumbnail, and the wrapper stays until it has", async () => {
    const m = twins()
    await raf()
    m.open(true)
    await settle()
    const wrap = m.q("[data-wrap]")!
    const big = m.q("[data-big]")!
    m.open(false)
    const seen: Array<{ present: boolean; apart: number; follower: number }> = []
    for (let i = 0; i < 100; i++) {
      await raf()
      seen.push({ present: wrap.isConnected, apart: apart(rectOf(big), rectOf(m.thumb)), follower: Number(getComputedStyle(big).opacity) })
    }
    const showing = seen.filter((s) => s.present && s.follower > 0.01)
    expect(showing.length, "frames the Follower shows").toBeGreaterThan(10)
    expect(Math.max(...showing.map((s) => s.apart)), "the Follower off the thumbnail, px").toBeLessThan(1)
    expect(seen.at(-1)!.present, "the wrapper goes after").toBe(false)
  })

  it("P8: the presence unmounted mid-close: the wrapper goes at once, and the thumbnail lands", async () => {
    const m = twins()
    await raf()
    m.open(true)
    await settle()
    const wrap = m.q("[data-wrap]")!
    m.open(false)
    for (let i = 0; i < 10; i++) await raf()
    expect(wrap.isConnected, "closing").toBe(true)
    m.present(false)
    expect(wrap.isConnected, "gone with the presence").toBe(false)
    await settle()
    expect(apart(rectOf(m.thumb), { l: 20, t: 300, r: 80, b: 340 }), "the thumbnail landed, px").toBeLessThan(0.5)
  })
})
