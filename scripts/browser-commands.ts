// The browser projects' shared commands (#806): what a test asks of the page it runs in, for @wardic/dom's
// project and, through packages/solid/vitest.browser-commands.ts, both bindings' and Foldkit's.
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import type { CDPSession } from "playwright"
import type { BrowserCommand, BrowserCommandContext } from "vitest/node"

/** A frame as `callerFrame` reads it: Playwright's `Frame`, or a test's stand-in. */
export interface FrameLike {
  readonly url: () => string
}

/** What `callerFrame` reads of a command's context: the page, and the test file that called. */
export interface CallerContext<F extends FrameLike> {
  readonly page: {
    readonly frames: () => ReadonlyArray<F>
    readonly waitForEvent: (event: "framenavigated", options: { readonly predicate: (frame: F) => boolean; readonly timeout: number }) => Promise<F>
  }
  readonly testPath: string | undefined
}

/** How long a command waits for its file's iframe to reach Playwright's view of the page. */
const FRAME_WAIT_MS = 10_000

/** The file a test iframe runs: vitest's orchestrator loads each at `/?sessionId=…&iframeId=<its file>`. */
const fileOf = (frame: FrameLike): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(URL.parse(frame.url())), (url) => Option.fromNullishOr(url.searchParams.get("iframeId")))

/**
 * The calling test file's own iframe, among the frames attached in Playwright's view of the page. Not
 * vitest's `ctx.frame()`, which takes the page's first frame named `vitest-iframe`: every file's iframe has
 * that name, and under load Playwright's view still holds the file before's when the next file's first
 * command arrives (#806). It reads an isolated run's iframes, one file to each: a project with
 * `isolate: false` runs every file in one iframe, and its commands would wait here and fail.
 */
export const callerFrame = <F extends FrameLike>(ctx: CallerContext<F>): Promise<F> => {
  const isCallers = (frame: F): boolean => Option.exists(fileOf(frame), (file) => file === ctx.testPath)
  return Option.match(Arr.findFirst(ctx.page.frames(), isCallers), {
    onNone: () =>
      ctx.page.waitForEvent("framenavigated", { predicate: isCallers, timeout: FRAME_WAIT_MS }).catch((cause: unknown) => {
        throw new Error(`no iframe for ${ctx.testPath} on the page (#806): ${String(cause)}`, { cause })
      }),
    onSome: (frame) => Promise.resolve(frame),
  })
}

/** Where the calling file's iframe sits on the page, so a client point inside it maps to a page point. */
export const iframeOffset = async (ctx: BrowserCommandContext): Promise<{ x: number; y: number }> => {
  const box = await (await (await callerFrame(ctx)).frameElement()).boundingBox()
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
 * calling file's iframe, then `button` pressed or released for `down` / `up`. `move: false` presses or
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
