// `WardicConfig`'s `skipAnimations` on Solid 2 (#468): the Solid 1 binding's (SK1–SK8), through
// `ward()`, `wardic.*`, presence, `createAnimate` and `createSpring`. A box beside, outside the
// config, still animating, as the control.
//
// - SKV1: a ward's and an element's 2 s tween land on the next frame, `next("settled")` resolving
//   then; outside, it moves.
// - SKV2: an exit removes its element at once.
// - SKV3: `createAnimate`'s `animate()` lands at once, and `createSpring` follows its source at once.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import {
  AnimatePresence,
  createAnimate,
  createSpring,
  ward,
  type WardicAnimate,
  wardic,
  WardicConfig,
  WardicProvider,
  type WardicTransition,
} from "@wardic/solid/unstable/v2"
import { createSignal, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const SLOW: WardicTransition = { type: "tween", duration: 2, ease: "linear" }
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX: JSX.CSSProperties = { display: "block", width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" }
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("WardicConfig's skipAnimations on Solid 2 (#468)", () => {
  it("SKV1: a ward's and an element's 2 s tween land on the next frame, next('settled') then; outside, it moves", async () => {
    const [x, setX] = createSignal(0)
    let card!: ReturnType<typeof ward>
    const Card = (): JSX.Element => {
      card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), transition: { type: "tween", duration: 2, ease: "linear", delay: 1 }, style: BOX })
      return <div id="skv-ward" {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig skipAnimations>
          <Card />
          <wardic.div id="skv-element" initial={{ x: 0 }} animate={{ x: x() }} transition={SLOW} style={BOX} />
        </WardicConfig>
        <wardic.div id="skv-outside" initial={{ x: 0 }} animate={{ x: x() }} transition={SLOW} style={BOX} />
      </WardicProvider>
    ))
    await frames(4)
    let landed = false
    void card.next("settled").then(() => (landed = true))
    setX(100)
    await frames(3)
    expect(landed, "landed at once").toBe(true)
    expect(xOf(byId("skv-ward"))).toBeCloseTo(100, 3)
    expect(xOf(byId("skv-element"))).toBeCloseTo(100, 3)
    expect(xOf(byId("skv-outside")), "outside, on its way").toBeLessThan(20)
  })

  it("SKV2: an exit removes its element at once", async () => {
    const [shown, setShown] = createSignal(true)
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig skipAnimations>
          <AnimatePresence>
            <Show when={shown()}>
              <wardic.div id="skv-leaving" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: SLOW }} style={BOX} />
            </Show>
          </AnimatePresence>
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(4)
    const el = byId("skv-leaving")
    setShown(false)
    await until(() => !el.isConnected, 300)
    expect(el.isConnected, "gone within 300 ms of a 2 s exit").toBe(false)
  })

  it("SKV3: createAnimate lands at once, and createSpring follows its source at once", async () => {
    let animate!: WardicAnimate
    const [source, setSource] = createSignal(0)
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      const spring = createSpring(source, { stiffness: 50, damping: 10 })
      const follower = ward({ style: { ...BOX, x: spring } })
      return (
        <div ref={scope}>
          <div id="skv-plain" style={BOX} />
          <div id="skv-spring" {...follower} />
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig skipAnimations>
          <Scene />
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(4)
    const controls = animate(byId("skv-plain"), { x: 100 }, SLOW)
    setSource(150)
    await frames(3)
    expect(xOf(byId("skv-plain")), "animate()'s").toBeCloseTo(100, 3)
    expect(controls.state).toBe("finished")
    expect(xOf(byId("skv-spring")), "the spring's").toBeCloseTo(150, 3)
  })
})
