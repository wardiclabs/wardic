// `transition.path` and `arc()` on Solid 2 (#438): Solid 1's PA1 and PA3, with `wardic.*`.
//
// - PAV1: `arc({ strength: 1 })` over 200 px bulges by half the distance midway, and lands.
// - PAV2: `rotate: true` turns it on its own channel; a `rotate` animation beside it composes, and it
//   ends on that alone.
// - PAV3 (#574): Solid 1's PA12: a target with `x` alone, caught mid-curve again and again, curves back
//   to its line.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { arc, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const BOX: JSX.CSSProperties = { display: "block", width: "40px", height: "40px", "margin-top": "160px", "margin-left": "160px", background: "teal" }
const LINEAR: WardicTransition = { type: "tween", duration: 0.6, ease: "linear" }

const mountMove = (transition: WardicTransition, initial: Record<string, number>) => {
  const [target, setTarget] = createSignal<Record<string, number>>(initial)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <wardic.div data-k="box" initial={initial} animate={target()} transition={transition} style={BOX} />
    </WardicProvider>
  ))
  return { to: setTarget, box: host.querySelector<HTMLElement>("[data-k=box]")! }
}

describe("transition.path and arc() on Solid 2 (#438)", () => {
  it("PAV1: arc({ strength: 1 }) over 200 px bulges by half the distance midway, and lands", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1 }) }, { x: 0, y: 0 })
    await frames(3)
    m.to({ x: 200 })
    let bulge = 0
    for (let i = 0; i < 50; i++) {
      await raf()
      bulge = Math.max(bulge, Math.abs(matrixOf(m.box).m42))
    }
    expect(bulge).toBeGreaterThan(90)
    expect(bulge).toBeLessThan(100.5)
    expect(matrixOf(m.box).m41).toBeCloseTo(200, 1)
    expect(matrixOf(m.box).m42).toBeCloseTo(0, 1)
  })

  it("PAV2: rotate: true turns it on its own channel; a rotate animation composes, and it ends on that alone", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1, rotate: true }) }, { x: 0, y: 0, rotate: 0 })
    await frames(3)
    m.to({ x: 200, y: 0, rotate: 90 })
    let turned = false
    for (let i = 0; i < 50; i++) {
      await raf()
      if (/rotate\([^)]*\) rotate\(/.test(m.box.style.transform)) turned = true
    }
    expect(turned, "the path's turn drawn after the element's own").toBe(true)
    const m2 = matrixOf(m.box)
    expect((Math.atan2(m2.b, m2.a) * 180) / Math.PI).toBeCloseTo(90, 1)
  })

  it("PAV3 (#574): a target with x alone, caught mid-curve again and again, curves back to its line", async () => {
    // No `y` anywhere, so no Base value returns it: the Path alone moves it.
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1 }) }, { x: 0 })
    await frames(3)
    m.to({ x: 200 })
    await frames(18)
    expect(Math.abs(matrixOf(m.box).m42), "mid-curve").toBeGreaterThan(20)
    m.to({ x: 0 })
    await frames(12)
    m.to({ x: 200 })
    await frames(50)
    expect(matrixOf(m.box).m41).toBeCloseTo(200, 1)
    expect(matrixOf(m.box).m42, "back on the line").toBeCloseTo(0, 1)
  })
})
