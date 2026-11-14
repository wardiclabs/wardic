// A Wardic instance at runtime (#516, ADR-0067 *Amendment (#516)*), on the Solid 1 binding:
// `createWardic(features)`'s elements bring its Features wherever they render.
// - IN1: an instance of `hover`: its `w.div` hovers under a provider given no Features.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWardic, hover, WardicProvider } from "@wardic/solid"
import type { JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { opacityOf, until } from "./browser-helpers.ts"
import { resetScene, settle } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const TWEEN = { type: "tween", duration: 0.2 } as const

/** Enters `el` with the pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const entering = (el: HTMLElement, done: () => boolean) => (): boolean => {
  el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
  return done()
}

/** Enters `el` until `done`, failing after `ms`. */
const hoverUntil = (el: HTMLElement, done: () => boolean, ms: number): Promise<void> => until(entering(el, done), ms)

describe("A Wardic instance (#516), Solid 1", () => {
  it("IN1: an instance of hover: its w.div hovers under a provider given no Features", async () => {
    const { w } = createWardic([hover])
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await settle()
    await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
  })
})
