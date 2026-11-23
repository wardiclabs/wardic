// Ref arrays (#884's PR 5; ADR-0073 decision 21, 8i), in real events: Solid 2 takes a list of refs, so one
// element goes to a ward and to sensors at once, `ref={[card, hovered, pressed]}`.
//
// - RA1: the ward animates the element, and each sensor reads it: a hover turns `whileHover` and
//   `hovered()` on, a press `pressed()`.
import { DomLive } from "@wardic/dom"
import { createHover, createPress, ward, WardicProvider } from "@wardic/solid"
import { flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"

const mouse = { pointerId: 1, pointerType: "mouse", isPrimary: true } as const

/** The element's committed scale: its computed matrix's a, 1 for none. */
const scaleOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 1
  return Number(/\(([^)]+)\)/.exec(t)![1]!.split(",")[0])
}

describe("ref arrays (#884's PR 5, 8i)", () => {
  it("RA1: ref={[card, hovered, pressed]} gives one element to a ward and two sensors", async () => {
    let hovered!: () => boolean
    let pressed!: () => boolean
    let el!: HTMLElement
    const Box = () => {
      const card = ward({ whileHover: { scale: 1.2 }, transition: { duration: 0.05 }, style: { width: "40px", height: "40px" } })
      const hover = createHover()
      const press = createPress()
      hovered = hover
      pressed = press
      return <div {...card} ref={[card, hover, press, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect([hovered(), pressed()]).toEqual([false, false])
    await until(() => {
      el.dispatchEvent(new PointerEvent("pointerenter", mouse))
      flush()
      return hovered()
    })
    await until(() => scaleOf(el) === 1.2, 4000, "the ward's whileHover")
    await until(() => {
      el.dispatchEvent(new PointerEvent("pointerdown", { ...mouse, button: 0, buttons: 1, bubbles: true }))
      flush()
      return pressed()
    })
    expect([hovered(), pressed(), scaleOf(el)]).toEqual([true, true, 1.2])
    el.dispatchEvent(new PointerEvent("pointerup", { ...mouse, button: 0, buttons: 0, bubbles: true }))
    await until(() => (flush(), !pressed()))
    expect(pressed()).toBe(false)
  })
})
