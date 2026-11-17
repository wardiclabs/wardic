// The browser's own mouse (Playwright's) for the browser tests, at viewport points, and the points it
// aims at. No Solid in it, so the Foldkit tier imports it too (#793); `reorder-harness.tsx` re-exports
// it for the Solid tests. Each event is the browser's (`isTrusted`), through its input pipeline.
import { commands } from "vitest/browser"
import "./browser-commands.ts"

/** A point in the viewport. */
export interface Pt {
  readonly x: number
  readonly y: number
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Whether the button is held, so a test that fails mid-press still releases it (`resetScene`).
let held = false

/** Whether the mouse's button is down. */
export const heldButton = (): boolean => held

export const mouse = {
  move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
  down: async (p: Pt): Promise<void> => {
    await commands.realMouse("down", p.x, p.y)
    held = true
  },
  up: async (p: Pt): Promise<void> => {
    await commands.realMouse("up", p.x, p.y)
    held = false
  },
}

/** Move the real mouse from `from` to `to` in `steps` moves, `ms` apart (each move also waits for its ack). */
export const glide = async (from: Pt, to: Pt, steps: number, ms = 20): Promise<void> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps })
    if (ms > 0) await wait(ms)
  }
}

export const add = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy })

/** `el`'s centre in the viewport. */
export const centreOf = (el: Element): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}
