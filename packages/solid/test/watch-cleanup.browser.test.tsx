// Gesture watches end with their element (#318, ADR-0055): a ward's hover, press and focus watches run
// in a Scope with no fiber, closed at the unmount.
//
// - WC1: every listener the watches add to the element is removed at the unmount.
// - WC2 (#379): a draggable ward unmounted mid-press removes every listener its drag track added, on
//   the element and, for the held pointer, on the window.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { countListeners } from "./listener-counts.ts"

it("WC1: every listener a ward's gesture watches add to its element is removed at the unmount", async () => {
  const counts = countListeners()
  try {
    let el!: HTMLElement
    const { unmount } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} whileHover={{ opacity: 0.9 }} whileTap={{ opacity: 0.8 }} whileFocus={{ opacity: 0.7 }} tabIndex={0} />
      </WardicProvider>
    ))
    for (let i = 0; i < 3; i++) await raf()
    const target = el
    expect(counts.added(target), "hover, press and focus listen on it").toBeGreaterThan(0)
    expect(counts.removed(target), "nothing removed while mounted").toBe(0)
    unmount()
    expect(counts.removed(target), "every one removed at the unmount").toBe(counts.added(target))
  } finally {
    counts.stop()
  }
})

it("WC2: a draggable ward unmounted mid-press removes every listener its drag track added, the held pointer's page-wide ones too", async () => {
  const counts = countListeners()
  try {
    let el!: HTMLElement
    const { unmount } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} drag="x" />
      </WardicProvider>
    ))
    for (let i = 0; i < 3; i++) await raf()
    const target = el
    expect(counts.added(target), "the drag track listens on it").toBeGreaterThan(0)
    const windowAdded = counts.added(window)
    const windowRemoved = counts.removed(window)
    target.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true }))
    const held = counts.added(window) - windowAdded
    expect(held, "the held pointer listens page-wide").toBeGreaterThan(0)
    unmount()
    expect(counts.removed(target), "every one removed from the element").toBe(counts.added(target))
    expect(counts.removed(window) - windowRemoved, "and the page-wide ones").toBeGreaterThanOrEqual(held)
  } finally {
    counts.stop()
  }
})
