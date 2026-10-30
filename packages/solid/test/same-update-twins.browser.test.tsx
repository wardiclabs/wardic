// A `layoutId` swap inside an `<AnimatePresence>`, the new twin arriving in the same update as its
// partner leaves (#482, ADR-0010 *Amendment (#482)*), in real paint. Motion's: the leaving twin is the
// new one's Follower, drawn on its flight every frame and fading out as the new one fades in, and goes
// when the handover ends. Before #482 the new twin flew as a Switch while the leaver stayed where it
// stood, and with no `exit` nothing flew. Solid 2's are SUV1–.
//
// - SU1: the twins as the presence's children, no `exit`, in `sync` and `popLayout`: the leaver rides
//   the new twin's flight, fading out as it fades in, and goes when the handover ends.
// - SU2: with an `exit` of their own: the crossfade replaces it (Q3), so the leaver stays at full
//   strength while the new twin fades in, as when the Lead was on screen first.
// - SU3: the twins inside leaving pages, in `sync` and `popLayout`: the card rides the hero's flight
//   over its page's exit, and the page goes when the handover ends.
// - SU4: a lone twin with no `exit`, no twin coming: gone by the end of the task, before a frame.
// - SU5: `mode="wait"`: the new twin mounts once the old has gone, so nothing flies.
// - SU6: back mid-crossfade: the first twin takes over again, and only it is left, at its own box.
// - SU7: the presence torn down in the task its twin left in: the leaver goes with it, its leave never decided.
// - SU8: a keyed twin back under its key in the same update takes over from its leaver (#286), as
//   React reuses its element: the leaver goes at once, and the new one moves on from where it was
//   drawn, at full strength, no crossfade.
// - SU9: the same, back in a second update of the task its twin left in, its leave still waiting: a
//   take-over too, the leaver gone at once.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

type Rect = { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
const rectOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { l: r.left, t: r.top, r: r.right, b: r.bottom }
}
const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b))
const opacityOf = (e: Element): number => Number(getComputedStyle(e).opacity)
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
/** The microtasks a task ends with, run: two hops past one queued in the update. */
const taskEnd = async (): Promise<void> => {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => queueMicrotask(resolve))
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

// A slow, linear flight, so its frames are easy to read.
const FLIGHT: WardicTransition = { layout: { type: "tween", duration: 0.5, ease: "linear" } }
const SMALL: JSX.CSSProperties = { width: "80px", height: "60px", background: "teal" }
const BIG: JSX.CSSProperties = { width: "240px", height: "180px", background: "teal" }
// Where each lands: the frame sits at (120, 120), clear of the page's one mouse at (5, 5).
const SMALL_AT = (nested: boolean): Rect => Bool.match(nested, { onTrue: () => ({ l: 130, t: 130, r: 210, b: 190 }), onFalse: () => ({ l: 120, t: 120, r: 200, b: 180 }) })
const BIG_AT = (nested: boolean): Rect => Bool.match(nested, { onTrue: () => ({ l: 160, t: 160, r: 400, b: 340 }), onFalse: () => ({ l: 120, t: 120, r: 360, b: 300 }) })

/** Two twins swapped under a presence of `mode`: the presence's children, or inside pages that fade out. */
const mount = (mode: "sync" | "popLayout" | "wait", nested: boolean, exit: boolean) => {
  const [page, setPage] = createSignal<"a" | "b">("a")
  const own = Bool.match(exit, { onTrue: () => ({ exit: { opacity: 0 } }), onFalse: () => ({}) })
  const small = () => <wardic.div data-k="small" layoutId="t" {...own} transition={FLIGHT} style={SMALL} />
  const big = () => <wardic.div data-k="big" layoutId="t" {...own} transition={FLIGHT} style={BIG} />
  const pageOf = (name: string, pad: string, child: () => JSX.Element) => (
    <wardic.section data-page={name} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.3 }} style={{ display: "block", padding: pad }}>
      {child()}
    </wardic.section>
  )
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", "margin-left": "120px", "margin-top": "120px" }}>
        <AnimatePresence mode={mode}>
          <Show when={page() === "a"} fallback={Bool.match(nested, { onTrue: () => pageOf("b", "40px", big), onFalse: big })}>
            {Bool.match(nested, { onTrue: () => pageOf("a", "10px", small), onFalse: small })}
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  const q = (k: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-k="${k}"]`)
  return { to: setPage, q, pages: () => Array.from(container.querySelectorAll<HTMLElement>("[data-page]")) }
}

/** Each frame after the swap to `b`: whether the leaver is on the page, how far it is from the new twin, and both opacities. */
const swap = async (m: ReturnType<typeof mount>, nested: boolean, n = 50) => {
  await frames(5)
  const small = m.q("small")!
  return paintsAfter(
    () => m.to("b"),
    () => {
      const big = Option.fromNullishOr(m.q("big"))
      return {
        present: small.isConnected,
        apart: Option.getOrUndefined(Option.map(big, (b) => apart(rectOf(small), rectOf(b)))),
        follower: opacityOf(small),
        lead: Option.getOrUndefined(Option.map(big, opacityOf)),
        landing: Option.getOrUndefined(Option.map(big, (b) => apart(rectOf(b), BIG_AT(nested)))),
        start: Option.getOrUndefined(Option.map(big, (b) => apart(rectOf(b), SMALL_AT(nested)))),
      }
    },
    n,
  )
}

describe("a layoutId swap in one update, under AnimatePresence (#482)", () => {
  for (const mode of ["sync", "popLayout"] as const) {
    it(`SU1 (${mode}): the twins as the presence's children, no exit: the leaver rides the flight, fading out, then goes`, async () => {
      const m = mount(mode, false, false)
      const seen = await swap(m, false)
      expect(seen[0]!.start, "the new twin starts on the leaver's box, px").toBeLessThan(6)
      const riding = seen.filter((s) => s.present && s.follower > 0.01)
      expect(riding.length, "frames the leaver shows").toBeGreaterThan(10)
      expect(Math.max(...riding.map((s) => s.apart ?? 99)), "the leaver off the new twin, px").toBeLessThan(0.75)
      expect(seen[0]!.lead!, "the new twin fades in from 0").toBeLessThan(0.6)
      expect(seen.some((s) => s.present && s.follower > 0.05 && s.follower < 0.95), "the leaver fades out").toBe(true)
      expect(seen.filter((s) => (s.landing ?? 99) > 0.5).every((s) => s.present), "the leaver stays while the handover runs").toBe(true)
      expect(seen.at(-1)!.present, "and goes after").toBe(false)
      expect(seen.at(-1)!.landing!, "the new twin on its own box").toBeLessThan(0.5)
    })

    it(`SU2 (${mode}): with an exit of their own: the crossfade replaces it`, async () => {
      const m = mount(mode, false, true)
      const seen = await swap(m, false)
      const riding = seen.filter((s) => s.present && s.follower > 0.01)
      expect(Math.max(...riding.map((s) => s.apart ?? 99)), "the leaver off the new twin, px").toBeLessThan(0.75)
      // The crossfade holds a Follower at full strength over its first half; an opacity exit would have it fading from the first frame.
      expect(Math.min(...seen.slice(0, 8).map((s) => s.follower)), "at full strength while the new twin fades in").toBeGreaterThan(0.95)
      expect(seen.at(-1)!.present, "gone once the handover ends").toBe(false)
    })

    it(`SU3 (${mode}): the twins inside leaving pages: the card rides the hero's flight over its page's exit`, async () => {
      const m = mount(mode, true, false)
      await frames(5)
      const pageA = m.pages()[0]!
      const seen = await swap(m, true)
      const riding = seen.filter((s) => s.present && s.follower > 0.01)
      expect(riding.length, "frames the card shows").toBeGreaterThan(10)
      expect(Math.max(...riding.map((s) => s.apart ?? 99)), "the card off the hero, px").toBeLessThan(0.75)
      expect(seen.filter((s) => (s.landing ?? 99) > 0.5).every((s) => s.present), "the card stays while the handover runs").toBe(true)
      expect(pageA.isConnected, "the page gone after").toBe(false)
    })
  }

  it("SU4: a lone twin with no exit, no twin coming: gone by the end of the task, before a frame", async () => {
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-k="lone" layoutId="t" style={SMALL} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(5)
    const lone = container.querySelector("[data-k=lone]")!
    let painted = false
    requestAnimationFrame(() => (painted = true))
    setShown(false)
    await taskEnd()
    expect(painted, "no frame yet").toBe(false)
    expect(lone.isConnected, "gone at the task's end").toBe(false)
  })

  it("SU5: mode=wait: the new twin mounts once the old has gone, so nothing flies", async () => {
    const m = mount("wait", false, false)
    await frames(5)
    m.to("b")
    let first: number | undefined
    for (let i = 0; i < 40 && first === undefined; i++) {
      await raf()
      const big = m.q("big")
      if (big !== null) first = apart(rectOf(big), BIG_AT(false))
    }
    expect(first, "the new twin at its own box from its first frame, px").toBeLessThan(0.5)
  })

  it("SU6: back mid-crossfade: the first twin takes over again, and only it is left, at its own box", async () => {
    const m = mount("popLayout", false, false)
    await frames(5)
    m.to("b")
    await frames(10)
    m.to("a")
    await frames(70)
    const smalls = Array.from(document.querySelectorAll("[data-k=small]"))
    expect(smalls.length, "one small twin").toBe(1)
    expect(m.q("big"), "the big one gone").toBeNull()
    expect(apart(rectOf(smalls[0]!), SMALL_AT(false)), "at its own box, px").toBeLessThan(0.5)
    expect(opacityOf(smalls[0]!), "fully shown").toBeCloseTo(1, 2)
  })

  it("SU7: the presence torn down in the task its twin left in: the leaver goes with it, its leave never decided", async () => {
    const [present, setPresent] = createSignal(true)
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Show when={present()}>
          <AnimatePresence>
            <Show when={shown()}>
              <wardic.div data-k="lone" layoutId="t" exit={{ opacity: 0 }} style={SMALL} />
            </Show>
          </AnimatePresence>
        </Show>
      </WardicProvider>
    ))
    await frames(5)
    setShown(false)
    setPresent(false)
    await taskEnd()
    await frames(5)
    expect(container.querySelector("[data-k=lone]"), "nothing left behind").toBeNull()
  })

  it("SU8: a keyed twin back under its key in the same update takes over from its leaver (#286)", async () => {
    const [big, setBig] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", "margin-left": "120px", "margin-top": "120px" }}>
          <AnimatePresence>
            <Show when={big()} fallback={<wardic.div key="k" data-k="small" layoutId="t" transition={FLIGHT} style={SMALL} />}>
              <wardic.div key="k" data-k="big" layoutId="t" transition={FLIGHT} style={BIG} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const small = container.querySelector("[data-k=small]")!
    const seen = await paintsAfter(
      () => setBig(true),
      () => {
        const b = container.querySelector("[data-k=big]")!
        return { leaver: small.isConnected, start: apart(rectOf(b), SMALL_AT(false)), lead: opacityOf(b) }
      },
      3,
    )
    expect(seen[0]!.leaver, "the leaver gone at once").toBe(false)
    expect(seen[0]!.start, "the new one on from where the leaver was drawn, px").toBeLessThan(6)
    expect(seen[0]!.lead, "at full strength: a take-over, no crossfade").toBeCloseTo(1, 2)
  })

  it("SU9: back under its key in a second update of the same task, its leave still waiting: a take-over too", async () => {
    const [a, setA] = createSignal(true)
    const [b, setB] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", "margin-left": "120px", "margin-top": "120px" }}>
          <AnimatePresence>
            <Show when={a()}>
              <wardic.div key="k" data-k="small" layoutId="t" transition={FLIGHT} style={SMALL} />
            </Show>
            <Show when={b()}>
              <wardic.div key="k" data-k="big" layoutId="t" transition={FLIGHT} style={BIG} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const small = container.querySelector("[data-k=small]")!
    const seen = await paintsAfter(
      () => {
        // Two updates in one task: Solid 1 runs each as it's set.
        setA(false)
        setB(true)
      },
      () => {
        const b = container.querySelector("[data-k=big]")!
        return { leaver: small.isConnected, start: apart(rectOf(b), SMALL_AT(false)), lead: opacityOf(b) }
      },
      3,
    )
    expect(seen[0]!.leaver, "the leaver gone at once").toBe(false)
    expect(seen[0]!.start, "the new one on from where the leaver was drawn, px").toBeLessThan(6)
    expect(seen[0]!.lead, "at full strength: a take-over, no crossfade").toBeCloseTo(1, 2)
  })
})
