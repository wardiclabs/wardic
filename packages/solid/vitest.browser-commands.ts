// The browser test projects' commands and pre-bundled modules, both bindings' (#209, #566): what a test asks
// of the page it runs in (real input, reduced motion, garbage collection, a line to the log).
import * as Bool from "effect/Boolean"
import type { CDPSession } from "playwright"
import type { BrowserCommand, BrowserCommandContext } from "vitest/node"

/** Where the test iframe sits on the page, so a client point inside it maps to a page point. */
const iframeOffset = async (ctx: BrowserCommandContext): Promise<{ x: number; y: number }> => {
  const box = await (await (await ctx.frame()).frameElement()).boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

/** Emulate `prefers-reduced-motion: reduce` (or clear it) on the test page and its frames (ADR-0029's tests). */
const emulateReducedMotion: BrowserCommand<[reduce: boolean]> = async (ctx, reduce) => {
  await ctx.page.emulateMedia({ reducedMotion: Bool.match(reduce, { onTrue: () => "reduce", onFalse: () => "no-preference" }) })
}

/**
 * Two full garbage collections, through Chromium's DevTools protocol, as @wardic/dom's (#418): for a
 * test of what a binding lets go of, read through a `WeakRef` afterwards (#431).
 */
const collectGarbage: BrowserCommand<[]> = async (ctx) => {
  const cdp: CDPSession = await ctx.page.context().newCDPSession(ctx.page)
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.detach()
}

/** One line to the test runner's stdout, so a browser test can leave numbers in a CI log (#206). */
const report: BrowserCommand<[line: string]> = (_ctx, line) => {
  process.stdout.write(`[report] ${line}\n`)
}

/**
 * Real pointer input for the drag tests (#26, #31): moves Playwright's mouse to the
 * client point `(x, y)` inside the test iframe, then presses or releases `button` for
 * `down` / `up`. Synthetic `PointerEvent`s are dispatched straight to their target, so
 * they can't show when the browser delivers input relative to a Refresh frame, or a
 * pointer leaving its element; these go through the browser's own input pipeline.
 * `move: false` presses or releases where the mouse already is, with no move first.
 */
const realMouse: BrowserCommand<[
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

/**
 * Real Playwright keyboard input (#43): `press` a key (down and up), or hold it with `down` (a
 * second `down` before its `up` is a repeat, as a held key's) and let it go with `up`. Sent to
 * whatever has focus in the page, through the browser's own input pipeline.
 */
const realKey: BrowserCommand<[type: "press" | "down" | "up", key: string]> = async (ctx, type, key) => {
  if (type === "press") await ctx.page.keyboard.press(key)
  if (type === "down") await ctx.page.keyboard.down(key)
  if (type === "up") await ctx.page.keyboard.up(key)
}

/** One DevTools session per page, with touch emulation on. */
const touchSessions = new WeakMap<object, Promise<CDPSession>>()

/**
 * Real touch input (#31) through Chromium's DevTools protocol (`Input.dispatchTouchEvent`),
 * Chromium only. `points` are the fingers down after the event, at client points in the
 * test iframe. The protocol's `touchEnd` lifts every finger, and leaving a finger out of a
 * `touchMove` doesn't lift it.
 */
const realTouch: BrowserCommand<[
  type: "touchStart" | "touchMove" | "touchEnd",
  points: ReadonlyArray<{ readonly x: number; readonly y: number; readonly id: number }>,
]> = async (ctx, type, points) => {
  let session = touchSessions.get(ctx.page)
  if (session === undefined) {
    session = ctx.context.newCDPSession(ctx.page).then(async (cdp) => {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
      return cdp
    })
    touchSessions.set(ctx.page, session)
  }
  const cdp = await session
  const offset = await iframeOffset(ctx)
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p) => ({ x: offset.x + p.x, y: offset.y + p.y, id: p.id })),
  })
}

/** Pre-bundled up front, in both bindings' browser projects (#209, #566). */
export const PREBUNDLED: ReadonlyArray<string> = [
      "culori/fn",
      "effect/Array",
      "effect/Boolean",
      "effect/Cause",
      "effect/Channel",
      "effect/Combiner",
      "effect/Context",
      "effect/Data",
      "effect/Deferred",
      "effect/devtools",
      "effect/Duration",
      "effect/Effect",
      "effect/Equal",
      "effect/Equivalence",
      "effect/ErrorReporter",
      "effect/Exit",
      "effect/Fiber",
      "effect/FiberHandle",
      "effect/FiberSet",
      "effect/Function",
      "effect/Hash",
      "effect/Inspectable",
      "effect/Iterable",
      "effect/Latch",
      "effect/Layer",
      "effect/LogLevel",
      "effect/ManagedRuntime",
      "effect/Match",
      "effect/Metric",
      "effect/MutableRef",
      "effect/Number",
      "effect/Option",
      "effect/Order",
      "effect/Pipeable",
      "effect/Predicate",
      "effect/PubSub",
      "effect/Queue",
      "effect/RcMap",
      "effect/RcRef",
      "effect/reactivity",
      "effect/Record",
      "effect/References",
      "effect/Result",
      "effect/Scheduler",
      "effect/Scope",
      "effect/Stream",
      "effect/String",
      "effect/Tracer",
      "effect/UndefinedOr",
]

/** The real-input commands, and the garbage collection, for both bindings' browser projects (#209, #566). */
export const BROWSER_COMMANDS = { collectGarbage, emulateReducedMotion, realKey, realMouse, realTouch, report }
