// `type: "inertia"` on Solid 2 (#435): Solid 1's IT1–IT5, through a ward.
//
// - ITV1: a ward's key glides at the transition's velocity, whatever its target, and bounces back to
//   `max`; `next("settled")` resolves once it rests there.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { ward, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX: JSX.CSSProperties = { display: "block", width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" }
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

describe("type: inertia on Solid 2 (#435)", () => {
  it("ITV1: a ward's key glides past its target and bounces back to max; next('settled') then", async () => {
    const [to, setTo] = createSignal(0)
    const [transition, setTransition] = createSignal<WardicTransition>({})
    let card!: ReturnType<typeof ward>
    const Card = (): JSX.Element => {
      card = ward({ initial: false, animate: () => ({ x: to() }), transition: () => transition(), style: BOX })
      return <div id="itv1" {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    for (let i = 0; i < 3; i++) await raf()
    const el = document.getElementById("itv1")!
    let most = 0
    const settled = card.next("settled")
    setTransition({ type: "inertia", velocity: 800, max: 50 })
    setTo(200)
    let landed = false
    void settled.then(() => (landed = true))
    for (let i = 0; i < 240 && !landed; i++) {
      await raf()
      most = Math.max(most, xOf(el))
    }
    expect(landed, "it settled").toBe(true)
    expect(most, "past its edge first").toBeGreaterThan(55)
    expect(xOf(el), "back on max").toBeCloseTo(50, 1)
  })
})
