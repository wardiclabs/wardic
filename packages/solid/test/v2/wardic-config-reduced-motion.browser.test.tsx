// `WardicConfig`'s `reducedMotion` on Solid 2 (#434's PR 2): the Solid 1 binding's, through `ward()`
// and `wardic.*`. Under it, `x` snaps; a box beside, outside the config, runs on the provider's.
//
// - WRV1: a config's "always" snaps a ward's and an element's x under a provider's "never"; a config's
//   "never" animates x under a provider's "always".
// - WRV2: an exit honours the leaving element's config, not its presence's: under "always" it lands
//   and goes at once.
import { DomLive } from "@wardic/dom"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type { JSX } from "@solidjs/web"
import { AnimatePresence, ward, wardic, WardicConfig, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { leftOf, raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const TWEEN: WardicTransition = { type: "tween", duration: 0.4, ease: "linear" }
const boxAt = (top: number): JSX.CSSProperties => ({ position: "absolute", left: "0px", top: `${top}px`, width: "40px", height: "40px" })
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Each element's left edge just after each of the next `n` paints. */
const paints = (els: ReadonlyArray<HTMLElement>, n: number): Promise<ReadonlyArray<ReadonlyArray<number>>> =>
  new Promise((resolve) => {
    const out: Array<Array<number>> = els.map(() => [])
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      els.forEach((el, i) => out[i]!.push(leftOf(el)))
      if (out[0]!.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(out)
    }
    requestAnimationFrame(post)
  })

const snapped = (lefts: ReadonlyArray<number>, a: number, b: number): boolean =>
  Bool.and(lefts.every((left) => Bool.or(left < a + 5, left > b - 5)), Math.abs(lefts.at(-1)! - b) < 0.5)
const animated = (lefts: ReadonlyArray<number>, a: number, b: number): boolean => lefts.some((left) => left > a + 5 && left < b - 5)

/** A ward and an element under a config of `config`, and an element outside it, moving x 0 → 200 when `go` is called. */
const mountTrio = async (provider: ReducedMotion.Config, config: ReducedMotion.Config) => {
  const [x, setX] = createSignal(0)
  const Card = (): JSX.Element => {
    const card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), transition: TWEEN, style: boxAt(0) })
    return <div id="ward" {...card} />
  }
  const mounted = mount(() => (
    <WardicProvider env={DomLive} reducedMotion={provider}>
      <div style={{ position: "relative", width: "600px", height: "180px" }}>
        <WardicConfig reducedMotion={config}>
          <Card />
          <wardic.div id="element" initial={{ x: 0 }} animate={{ x: x() }} transition={TWEEN} style={boxAt(60)} />
        </WardicConfig>
        <wardic.div id="outside" initial={{ x: 0 }} animate={{ x: x() }} transition={TWEEN} style={boxAt(120)} />
      </div>
    </WardicProvider>
  ))
  await frames(4)
  const base = leftOf(byId("ward"))
  setX(200)
  const [card, element, outside] = await paints([byId("ward"), byId("element"), byId("outside")], 10)
  return { base, card: card!, element: element!, outside: outside!, unmount: mounted.unmount }
}

describe("WardicConfig's reducedMotion on Solid 2 (#434)", () => {
  it("WRV1: a config's \"always\" snaps x under a provider's \"never\"; its \"never\" animates x under \"always\"", async () => {
    const always = await mountTrio("never", "always")
    expect(snapped(always.card, always.base, always.base + 200), "the ward snaps").toBe(true)
    expect(snapped(always.element, always.base, always.base + 200), "the element snaps").toBe(true)
    expect(animated(always.outside, always.base, always.base + 200), "outside animates").toBe(true)
    always.unmount()
    const never = await mountTrio("always", "never")
    expect(animated(never.card, never.base, never.base + 200), "the ward animates").toBe(true)
    expect(animated(never.element, never.base, never.base + 200), "the element animates").toBe(true)
    expect(snapped(never.outside, never.base, never.base + 200), "outside snaps").toBe(true)
  })

  it("WRV2: an exit honours the leaving element's config, not its presence's", async () => {
    const [shown, setShown] = createSignal(true)
    mount(() => (
      <WardicProvider env={DomLive} reducedMotion="never">
        <div style={{ position: "relative", width: "600px", height: "120px" }}>
          <AnimatePresence>
            <Show when={shown()}>
              <WardicConfig reducedMotion="always">
                <wardic.div id="inside" style={boxAt(0)} initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 200, transition: TWEEN }} />
              </WardicConfig>
              <wardic.div id="outside" style={boxAt(60)} initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 200, transition: TWEEN }} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    const inside = byId("inside")
    const outside = byId("outside")
    const base = leftOf(inside)
    setShown(false)
    const [o] = await paints([outside], 6)
    expect(inside.isConnected, "its config's \"always\": its exit landed at once").toBe(false)
    expect(animated(o!, base, base + 200), "beside it, the provider's \"never\"").toBe(true)
  })
})
