// The gesture props taking a variant name on Solid 2 (#291), as the Solid 1 binding's GN tests pin
// them. Real frames, under the diagnostics gate.
//
// - GW1: `whileHover="hover"`: the element's own entry while hovered, back at its end.
// - GW2: the name passes to Variant children while the parent is hovered.
// - GW3: a child's own `whileHover` is on with its parent's hover, over the name it would take.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicVariants } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform)
const QUICK = { type: "tween", duration: 0.1 } as const
const BOX = { display: "inline-block", width: "40px", height: "40px" } as const

const mountIn = (ui: () => JSX.Element) => {
  const { host } = mount(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => host.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

const hover = async (el: HTMLElement, held: () => boolean): Promise<void> => {
  await until(() => {
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    return held()
  }, 2000)
}

describe("gesture props taking a variant name on Solid 2 (#291)", () => {
  it("GW1: whileHover='hover': the element's own entry while hovered, back at its end", async () => {
    const card: WardicVariants = { rest: { scale: 1 }, hover: { scale: 1.5 } }
    const q = mountIn(() => <wardic.div data-k="a" variants={card} initial="rest" animate="rest" whileHover="hover" transition={QUICK} style={BOX} />)
    await frames(3)
    const a = q("a")
    await hover(a, () => matrixOf(a).a > 1.45)
    expect(matrixOf(a).a).toBeGreaterThan(1.45)
    a.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, bubbles: true }))
    await until(() => matrixOf(a).a < 1.05, 2000)
    expect(matrixOf(a).a).toBeLessThan(1.05)
  })

  it("GW2: the name passes to Variant children while the parent is hovered", async () => {
    const card: WardicVariants = { rest: {}, hover: {} }
    const icon: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mountIn(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover="hover" style={BOX}>
        <wardic.span data-k="icon" variants={icon} transition={QUICK} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await frames(3)
    const iconEl = q("icon")
    await hover(q("card"), () => matrixOf(iconEl).m41 > 19)
    expect(matrixOf(iconEl).m41).toBeGreaterThan(19)
  })

  it("GW3: a child's own whileHover is on with its parent's hover, over the name it would take", async () => {
    const card: WardicVariants = { rest: {}, hover: {} }
    const icon: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mountIn(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover="hover" style={BOX}>
        <wardic.span data-k="icon" variants={icon} whileHover={{ x: -20 }} transition={QUICK} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await frames(3)
    const iconEl = q("icon")
    await hover(q("card"), () => matrixOf(iconEl).m41 < -19)
    expect(matrixOf(iconEl).m41).toBeLessThan(-19)
  })
})
