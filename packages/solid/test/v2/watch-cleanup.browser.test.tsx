// Gesture watches end with their element on Solid 2 (#318, ADR-0055): a ward's hover, press and focus
// watches run in its mount's Scope, closed at the unmount.
//
// - WC1: every listener the watches add to the element is removed at the unmount.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { countListeners } from "../listener-counts.ts"
import { mount } from "./mount.tsx"

it("WC1: every listener a ward's gesture watches add to its element is removed at the unmount", async () => {
  const counts = countListeners()
  try {
    let el!: HTMLElement
    const { unmount } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} whileHover={{ opacity: 0.9 }} whileTap={{ opacity: 0.8 }} whileFocus={{ opacity: 0.7 }} tabindex={0} />
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
