// Measured pairs (#430), on Solid 2: a ward's landing is its target as given. Solid 1's are MS1–MS8.
//
// - MW1: an accordion ward opens from 0 to `auto` through the px between; `next("settled")` resolves
//   with `{ height: "auto" }`, and the element is left on `height: auto`.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const PANEL = { width: "120px", overflow: "hidden", "line-height": "20px", "margin-top": "120px", "margin-left": "120px" } as const

describe("Measured pairs on Solid 2 (#430)", () => {
  it("MW1: an accordion ward opens to auto, and next('settled') lands on height: auto", async () => {
    const [open, setOpen] = createSignal(false)
    let card!: Ward
    const Card = (): JSX.Element => {
      card = ward({
        initial: { height: 0 },
        animate: () => ({ height: Bool.match(open(), { onTrue: (): "auto" | 0 => "auto", onFalse: (): "auto" | 0 => 0 }) }),
        transition: { type: "tween", duration: 0.4, ease: "linear" },
        style: PANEL,
      })
      return (
        <div data-card {...card}>
          <div>one</div>
          <div>two</div>
          <div>three</div>
        </div>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    for (let i = 0; i < 4; i++) await raf()
    const el = host.querySelector<HTMLElement>("[data-card]")!
    const landed = card.next("settled")
    setOpen(true)
    flush()
    const heights: Array<number> = []
    for (let i = 0; i < 12; i++) {
      await raf()
      heights.push(el.getBoundingClientRect().height)
    }
    expect(heights.some((h) => h > 15 && h < 45), "through the px between 0 and 60").toBe(true)
    expect((await landed).target).toEqual({ height: "auto" })
    expect(el.style.height).toBe("auto")
    expect(el.getBoundingClientRect().height).toBeCloseTo(60, 0)
  })
})
