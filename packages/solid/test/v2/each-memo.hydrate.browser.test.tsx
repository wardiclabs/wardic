// A ward's events read as an async value across a streamed server render (#343, ADR-0046 *Note
// (#343)*): a memo over `card.each("dragEnd")` and an effect, the README's swipe pattern. On a
// server `each` ends at once, and a streamed render serializes the memo's answer, `undefined`, for
// hydration to adopt.
//
// - HE1: with `ssrSource: "client"` (the README's form), the memo is the browser's: the effect hears
//   nothing at hydration, then the release, with its offset.
// - HE2: a plain memo adopts the server's `undefined`: the effect runs once with it, and never hears
//   the release. The trap the README's form avoids: if Solid changes this, the README can say less.
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import * as F from "./hydrate-fixtures.tsx"
import { hydrateStreamed2 } from "./hydrate.ts"

afterEach(() => {
  F.heard.length = 0
})

const pointer = (at: EventTarget, type: string, x: number, y: number, buttons = 0): void => {
  at.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, buttons, button: 0, bubbles: true }))
}

/** Drag `el` by `dx` from its middle in four moves a frame apart, released on the page. */
const swipe = async (el: HTMLElement, dx: number): Promise<void> => {
  const box = el.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  pointer(el, "pointerdown", x, y, 1)
  for (const k of [1, 2, 3, 4]) {
    await raf()
    pointer(el, "pointermove", x + (dx * k) / 4, y, 1)
  }
  await raf()
  pointer(document.body, "pointerup", x + dx, y)
}

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("a memo over each(…) across a streamed server render (#343)", () => {
  it("HE1: with ssrSource: \"client\", the effect hears the release, and nothing before it", async () => {
    const h = await hydrateStreamed2("HE1", F.HE1)
    await frames(4)
    expect(h.claimed("card"), "the server's card hydrated").toBe(true)
    expect(F.heard, "nothing at hydration").toEqual([])
    await swipe(h.host.querySelector<HTMLElement>('[data-k="card"]')!, 60)
    await until(() => F.heard.length > 0, 2000)
    expect(F.heard).toHaveLength(1)
    expect(F.heard[0], "the release's offset").toBeGreaterThan(40)
  })

  it("HE2: a plain memo adopts the server's undefined, and never hears the release", async () => {
    const h = await hydrateStreamed2("HE2", F.HE2)
    await frames(4)
    expect(F.heard, "the server's answer, adopted").toEqual([undefined])
    await swipe(h.host.querySelector<HTMLElement>('[data-k="card"]')!, 60)
    await frames(10)
    expect(F.heard, "no release heard").toEqual([undefined])
  })
})
