// A bare number on a CSS length, drawn (#522, Motion's `animate={{ height: 200 }}`), on Solid 2.
//
// - LBV1: a number on a one-word length and on multi-word ones lands in px: `height`, `margin-top`,
//   `border-top-left-radius`.
// - LBV2: a Keyframes list mixing numbers and strings (`[0, "100px", 200]`) is drawn through every
//   frame in px and lands on its last stop.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const FAST = { type: "tween", ease: "linear", duration: 0.1 } as const

const show = (ui: () => JSX.Element): HTMLElement => {
  const { host } = mount(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return host.querySelector<HTMLElement>("[data-box]")!
}

const px = (el: Element, key: string): number => Number.parseFloat(getComputedStyle(el).getPropertyValue(key))

describe("a bare number on a CSS length, drawn on Solid 2 (#522)", () => {
  it("LBV1: a number on a one-word and on multi-word lengths lands in px", async () => {
    const box = show(() => (
      <wardic.div data-box style={{ width: "40px" }} initial={{ height: 0 }} animate={{ height: 200, "margin-top": 20, "border-top-left-radius": 8 }} transition={FAST} />
    ))
    await until(() => px(box, "height") === 200, 2000, "height lands at 200px")
    expect(getComputedStyle(box).getPropertyValue("margin-top")).toBe("20px")
    expect(getComputedStyle(box).getPropertyValue("border-top-left-radius")).toBe("8px")
  })

  it("LBV2: a Keyframes list mixing numbers and strings is drawn in px through every frame", async () => {
    const box = show(() => <wardic.div data-box style={{ width: "40px" }} initial={{ height: 0 }} animate={{ height: [0, "100px", 200] }} transition={{ ...FAST, duration: 0.3 }} />)
    const heights: Array<number> = []
    while (px(box, "height") < 200 && heights.length < 120) {
      await raf()
      heights.push(px(box, "height"))
    }
    expect(heights.at(-1), "it lands on its last stop").toBe(200)
    expect(heights.filter((h) => h > 0 && h < 200).length, "frames between its stops").toBeGreaterThan(3)
    expect(heights.every((h) => Number.isFinite(h) && h >= 0 && h <= 200), heights.join(", ")).toBe(true)
  })
})
