// The browser commands registered in packages/solid/vitest.browser.config.ts (and
// `serverRender`, in packages/solid/vitest.hydrate.config.ts; `serverRender2` and `serverStream2`, in
// vitest.hydrate-v2.config.ts), typed
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

/** What {@link BrowserCommands.serverRender} returns. */
export interface ServerRender {
  readonly html: string
  readonly script: string
  /** The server render's error, first line; `""` when it rendered. */
  readonly error: string
}

declare module "vitest/browser" {
  interface BrowserCommands {
    /** Real Playwright keyboard input to whatever has focus: a press, or a key held (`down`, a second `down` repeats) and let go. */
    realKey: (type: "press" | "down" | "up", key: string) => Promise<void>
    /** One line to the test runner's stdout, so a browser test can leave numbers in a CI log (#206). */
    report: (line: string) => Promise<void>
    /** Two full garbage collections (Chromium's DevTools protocol), before reading a `WeakRef` (#431). */
    collectGarbage: () => Promise<void>
    /** Real Playwright mouse input at a client point in the test iframe. */
    realMouse: (type: "move" | "down" | "up", x: number, y: number, options?: RealMouseOptions) => Promise<void>
    /**
     * Real touch input through Chromium's DevTools protocol (Chromium only). `points` are
     * the fingers down after the event; `touchEnd` lifts every finger.
     */
    realTouch: (type: "touchStart" | "touchMove" | "touchEnd", points: ReadonlyArray<RealTouchPoint>) => Promise<void>
    /**
     * Server-render `exportName` from `file` (relative to packages/solid) in Node with
     * Solid's server build, under `renderId`: the markup and the hydration script, or the
     * error's first line (the hydrate project only).
     */
    serverRender: (file: string, exportName: string, renderId: string) => Promise<ServerRender>
    /**
     * The Solid 2 binding's server render (#209 PR 4a, the v2-hydrate project): `exportName` from
     * `file` with `@solidjs/web`'s server build under `renderId`; its head tags (`onHead`) as `head`.
     */
    serverRender2: (file: string, exportName: string, renderId: string) => Promise<ServerRender & { readonly head: string }>
    /** `serverRender2` streamed (`renderToStream`): the head, then each write as the stream sent it. */
    serverStream2: (
      file: string,
      exportName: string,
      renderId: string,
    ) => Promise<{ readonly writes: ReadonlyArray<string>; readonly head: string; readonly script: string; readonly error: string }>
    /** `serverRender` as a page with a head: what the render put before `</head>` as `head` (#48). */
    serverRenderPage: (file: string, exportName: string, renderId: string) => Promise<ServerRender & { readonly head: string }>
    /** `exportName` streamed as a page with a head (#245): each write as `renderToStream` sends it. */
    serverStreamPage: (
      file: string,
      exportName: string,
      renderId: string,
    ) => Promise<{ readonly writes: ReadonlyArray<string>; readonly script: string; readonly error: string }>
    /** Emulate `prefers-reduced-motion: reduce`, or clear it. */
    emulateReducedMotion: (reduce: boolean) => Promise<void>
  }
}
