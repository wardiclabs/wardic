import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"
import type { BrowserCommand } from "vitest/node"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Real-browser test project for @wardic/dom — the DOM realization of the engine's
// ports (Clock/Input/Probe/Renderer). happy-dom has no layout engine and never
// fires ResizeObserver/IntersectionObserver/matchMedia "change" or real pointer
// timing, so the old suites could only assert wiring/shape. Here Chromium
// (Playwright) gives REAL observer emissions, real geometry, and real event
// timeStamps, so the DOM ports are verified against actual browser behaviour.
//
// Browsers come from the nix devshell (PLAYWRIGHT_BROWSERS_PATH in flake.nix);
// npm `playwright` is pinned to 1.59.1 to match (chromium revision 1217).
//
// No Solid plugin here (this package has no JSX). Tests import from @effect/vitest
// and are named `*.browser.test.ts`. Run via `bun run test:browser` (the root
// browser config composes this with the @wardic/solid browser project).
/**
 * Two full garbage collections, through Chromium's DevTools protocol: for a test of what the engine
 * lets go of, read through a `WeakRef` afterwards (#418). Typed in `test/browser-commands.ts`.
 */
const collectGarbage: BrowserCommand<[]> = async (ctx) => {
  const cdp = await ctx.page.context().newCDPSession(ctx.page)
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.detach()
}

/** Where the test's iframe sits in the page, which Playwright's mouse moves over. */
const iframeOffset = async (ctx: Parameters<BrowserCommand<[]>>[0]): Promise<{ x: number; y: number }> => {
  const box = await (await (await ctx.frame()).frameElement()).boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

/**
 * Real pointer input (#712), as the Solid binding's tests have it: Playwright's mouse moved to the client
 * point `(x, y)` inside the test iframe, then pressed or released for `down` / `up`. A trusted event runs
 * the page's microtasks between its listeners, where a dispatched one runs them only after the last.
 */
const realMouse: BrowserCommand<[type: "move" | "down" | "up", x: number, y: number]> = async (ctx, type, x, y) => {
  const offset = await iframeOffset(ctx)
  await ctx.page.mouse.move(offset.x + x, offset.y + y)
  if (type === "down") await ctx.page.mouse.down()
  if (type === "up") await ctx.page.mouse.up()
}

export default defineConfig({
  // `@wardic/*` from its source (#554).
  plugins: [wardicSource()],
  root: import.meta.dirname,
  // Pre-bundled up front: Vite otherwise discovers a test's first import of it
  // mid-run and reloads the page once ("optimized dependencies changed. reloading").
  optimizeDeps: {
    include: [
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
      "effect/Logger",
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
      "effect/socket",
      "effect/Stream",
      "effect/String",
      "effect/Tracer",
      "effect/UndefinedOr",
    ],
  },
  test: {
    name: "dom-browser",
    include: ["test/**/*.browser.test.{ts,tsx}"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers).
    setupFiles: ["./test/browser-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { collectGarbage, realMouse },
    },
  },
})
