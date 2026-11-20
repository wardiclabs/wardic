// The browser test projects' commands and pre-bundled modules, both bindings' (#209, #566): what a test asks
// of the page it runs in (real input, reduced motion, garbage collection, a line to the log). The mouse and
// the garbage collection are the shared ones in scripts/browser-commands.ts, @wardic/dom's too (#806).
import * as Bool from "effect/Boolean"
import type { CDPSession } from "playwright"
import type { BrowserCommand } from "vitest/node"
import { collectGarbage, iframeOffset, realMouse } from "../../scripts/browser-commands.ts"

/** Emulate `prefers-reduced-motion: reduce` (or clear it) on the test page and its frames (ADR-0029's tests). */
const emulateReducedMotion: BrowserCommand<[reduce: boolean]> = async (ctx, reduce) => {
  await ctx.page.emulateMedia({ reducedMotion: Bool.match(reduce, { onTrue: () => "reduce", onFalse: () => "no-preference" }) })
}

/** One line to the test runner's stdout, so a browser test can leave numbers in a CI log (#206). */
const report: BrowserCommand<[line: string]> = (_ctx, line) => {
  process.stdout.write(`[report] ${line}\n`)
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
