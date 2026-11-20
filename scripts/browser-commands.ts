// The browser projects' shared commands (#806): what a test asks of the page it runs in, for @wardic/dom's
// project and, through packages/solid/vitest.browser-commands.ts, both bindings' and Foldkit's.
import type { CDPSession } from "playwright"
import type { BrowserCommand, BrowserCommandContext } from "vitest/node"

/** Where the test iframe sits on the page, so a client point inside it maps to a page point. */
export const iframeOffset = async (ctx: BrowserCommandContext): Promise<{ x: number; y: number }> => {
  const box = await (await (await ctx.frame()).frameElement()).boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

/**
 * Two full garbage collections, through Chromium's DevTools protocol (#418): for a test of what the engine
 * or a binding lets go of, read through a `WeakRef` afterwards (#431).
 */
export const collectGarbage: BrowserCommand<[]> = async (ctx) => {
  const cdp: CDPSession = await ctx.page.context().newCDPSession(ctx.page)
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.detach()
}

/**
 * Real pointer input (#26, #31, #712): Playwright's mouse moved to the client point `(x, y)` inside the
 * test iframe, then `button` pressed or released for `down` / `up`. `move: false` presses or
 * releases where the mouse already is, with no move first.
 *
 * The events go through the browser's own input pipeline. A dispatched `PointerEvent` goes straight to its
 * target, so it can't show when the browser delivers input relative to a Refresh frame or a pointer leaving
 * its element, and it runs the page's microtasks only after its last listener, where a trusted event runs
 * them between listeners.
 */
export const realMouse: BrowserCommand<[
  type: "move" | "down" | "up",
  x: number,
  y: number,
  options?: { readonly button?: "left" | "right"; readonly move?: boolean },
]> = async (ctx, type, x, y, options) => {
  if (options?.move !== false) {
    const offset = await iframeOffset(ctx)
    await ctx.page.mouse.move(offset.x + x, offset.y + y)
  }
  const button = options?.button ?? "left"
  if (type === "down") await ctx.page.mouse.down({ button })
  if (type === "up") await ctx.page.mouse.up({ button })
}
