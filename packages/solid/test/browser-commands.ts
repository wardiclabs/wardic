// The browser commands registered in packages/solid/vitest.browser.config.ts, typed
// once for every test file that imports this module (a second `declare module` block
// with a different signature wouldn't compile).
import type {} from "vitest/browser"

/** Options for {@link BrowserCommands.realMouse}. */
export interface RealMouseOptions {
  /** The button to press or release (default `"left"`). */
  readonly button?: "left" | "right"
  /** Move to `(x, y)` first (default `true`). `false` presses or releases where the mouse already is. */
  readonly move?: boolean
}

/** One finger for {@link BrowserCommands.realTouch}, at a client point in the test iframe. */
export interface RealTouchPoint {
  readonly x: number
  readonly y: number
  readonly id: number
}

declare module "vitest/browser" {
  interface BrowserCommands {
    /** Real Playwright mouse input at a client point in the test iframe. */
    realMouse: (type: "move" | "down" | "up", x: number, y: number, options?: RealMouseOptions) => Promise<void>
    /**
     * Real touch input through Chromium's DevTools protocol (Chromium only). `points` are
     * the fingers down after the event; `touchEnd` lifts every finger.
     */
    realTouch: (type: "touchStart" | "touchMove" | "touchEnd", points: ReadonlyArray<RealTouchPoint>) => Promise<void>
  }
}
