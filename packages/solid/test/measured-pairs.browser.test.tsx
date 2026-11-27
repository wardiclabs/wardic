// Measured pairs (#430), on Solid 2: a ward's landing is its target as given. Solid 1's are MS1–MS8.
//
// - MW1: an accordion ward opens from 0 to `auto` through the px between; `next("settled")` resolves
//   with `{ height: "auto" }`, and the element is left on `height: auto`.
// - MW2 (#979, row 8; ADR-0074): an exit's pairs whose Transform template throws switch, reported once
//   through the app's logger, and an accordion's pairs asked in the same batch are measured.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type Ward, ward, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"
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

  it("MW2 (#979, row 8): an exit's pairs whose Transform template throws switch, reported once; an accordion's pairs in the same batch are measured", async () => {
    const logs: Array<Logged> = []
    const [open, setOpen] = createSignal(false)
    const [visible, setVisible] = createSignal(true)
    let failing = false
    const template = (_: unknown, generated: string): string => {
      if (failing) throw new Error("template failed")
      return generated
    }
    const Card = (): JSX.Element => {
      const card = ward({
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
      <WardicProvider env={envWith({ logs, reports: [] })}>
        <Card />
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-leaver initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: "100%" }} transformTemplate={template} transition={{ type: "tween", duration: 0.3 }} style={{ width: "100px", height: "20px" }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    for (let i = 0; i < 4; i++) await raf()
    const el = host.querySelector<HTMLElement>("[data-card]")!
    const leaver = host.querySelector<HTMLElement>("[data-leaver]")!
    // In one task: the accordion opens and the leaver goes, so both ask the one batch.
    failing = true
    setOpen(true)
    setVisible(false)
    flush()
    const heights: Array<number> = []
    for (let i = 0; i < 12; i++) {
      await raf()
      heights.push(el.getBoundingClientRect().height)
    }
    expect(heights.some((h) => h > 15 && h < 45), "the accordion, through the px between 0 and 60").toBe(true)
    await until(() => !leaver.isConnected, 2000, "the leaver leaves")
    const failed = errorsNamed(logs, "wardic.presence: an exit's Measured pairs failed")
    expect(failed, "reported once").toHaveLength(1)
    expect(failed[0]!.cause).toContain("template failed")
  })
})
