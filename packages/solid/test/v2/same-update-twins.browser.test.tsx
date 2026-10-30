// A `layoutId` swap in one update under `<AnimatePresence>` on Solid 2 (#482): Solid 1's SU1–SU3, with
// `wardic.*`. Solid 2 may register the new twin before or after its presence takes the leave; either
// way the leaver rides the new twin's flight.
//
// - SUV1: the twins as the presence's children, no `exit`: the leaver rides the flight, fading out
//   as the new twin fades in, and goes when the handover ends.
// - SUV2: with an `exit` of their own: the crossfade replaces it.
// - SUV3: the twins inside leaving pages: the card rides the hero's flight, and its page goes after.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import { createSignal, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

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

const FLIGHT: WardicTransition = { layout: { type: "tween", duration: 0.5, ease: "linear" } }
const SMALL: JSX.CSSProperties = { width: "80px", height: "60px", background: "teal" }
const BIG: JSX.CSSProperties = { width: "240px", height: "180px", background: "teal" }

const mountSwap = (nested: boolean, exit: boolean) => {
  const [page, setPage] = createSignal<"a" | "b">("a")
  const own = Bool.match(exit, { onTrue: () => ({ exit: { opacity: 0 } }), onFalse: () => ({}) })
  const small = () => <wardic.div data-k="small" layoutId="t" {...own} transition={FLIGHT} style={SMALL} />
  const big = () => <wardic.div data-k="big" layoutId="t" {...own} transition={FLIGHT} style={BIG} />
  const pageOf = (name: string, pad: string, child: () => JSX.Element) => (
    <wardic.section data-page={name} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.3 }} style={{ display: "block", padding: pad }}>
      {child()}
    </wardic.section>
  )
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", "margin-left": "120px", "margin-top": "120px" }}>
        <AnimatePresence mode="popLayout">
          <Show when={page() === "a"} fallback={Bool.match(nested, { onTrue: () => pageOf("b", "40px", big), onFalse: big })}>
            {Bool.match(nested, { onTrue: () => pageOf("a", "10px", small), onFalse: small })}
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  const q = (k: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-k="${k}"]`)
  return { to: setPage, q, pages: () => Array.from(host.querySelectorAll<HTMLElement>("[data-page]")) }
}

const swap = async (m: ReturnType<typeof mountSwap>, n = 50) => {
  await frames(5)
  const small = m.q("small")!
  return paintsAfter(
    () => m.to("b"),
    () => {
      const big = Option.fromNullishOr(m.q("big"))
      return {
        present: small.isConnected,
        apart: Option.match(big, { onNone: () => 99, onSome: (b) => apart(rectOf(small), rectOf(b)) }),
        follower: opacityOf(small),
      }
    },
    n,
  )
}

describe("a layoutId swap in one update, under AnimatePresence, on Solid 2 (#482)", () => {
  it("SUV1: the twins as the presence's children, no exit: the leaver rides the flight, fading out, then goes", async () => {
    const seen = await swap(mountSwap(false, false))
    const riding = seen.filter((s) => s.present && s.follower > 0.01)
    expect(riding.length, "frames the leaver shows").toBeGreaterThan(10)
    expect(Math.max(...riding.map((s) => s.apart)), "the leaver off the new twin, px").toBeLessThan(0.75)
    expect(seen.some((s) => s.present && s.follower > 0.05 && s.follower < 0.95), "the leaver fades out").toBe(true)
    expect(seen.at(-1)!.present, "and goes after").toBe(false)
  })

  it("SUV2: with an exit of their own: the crossfade replaces it", async () => {
    const seen = await swap(mountSwap(false, true))
    const riding = seen.filter((s) => s.present && s.follower > 0.01)
    expect(Math.max(...riding.map((s) => s.apart)), "the leaver off the new twin, px").toBeLessThan(0.75)
    expect(Math.min(...seen.slice(0, 8).map((s) => s.follower)), "at full strength while the new twin fades in").toBeGreaterThan(0.95)
    expect(seen.at(-1)!.present, "gone once the handover ends").toBe(false)
  })

  it("SUV3: the twins inside leaving pages: the card rides the hero's flight, its page gone after", async () => {
    const m = mountSwap(true, false)
    await frames(5)
    const pageA = m.pages()[0]!
    const seen = await swap(m)
    const riding = seen.filter((s) => s.present && s.follower > 0.01)
    expect(riding.length, "frames the card shows").toBeGreaterThan(10)
    expect(Math.max(...riding.map((s) => s.apart)), "the card off the hero, px").toBeLessThan(0.75)
    expect(pageA.isConnected, "the page gone after").toBe(false)
  })
})
