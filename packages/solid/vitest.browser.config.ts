import { playwright } from "@vitest/browser-playwright"
import type { CDPSession } from "playwright"
import solidPlugin from "vite-plugin-solid"
import { configDefaults, defineConfig } from "vitest/config"
import type { BrowserCommand, BrowserCommandContext } from "vitest/node"

// Real-browser test project for @wardic/solid — layout/projection behaviours that
// happy-dom CANNOT verify (it has no layout engine, so getBoundingClientRect is
// all-zeros). Here Chromium (Playwright) gives REAL layout + real CSS transform
// composition, so projection FLIP / treeScale / relativeTarget can be asserted
// against actual measured geometry.
//
// Browsers come from the nix devshell (PLAYWRIGHT_BROWSERS_PATH, set in flake.nix
// to nixpkgs' playwright-driver.browsers — the prebuilt Playwright download fails
// on nix with a missing libnspr4.so). npm `playwright` is pinned to 1.59.1 to
// match those browsers (chromium revision 1217).
//
// Kept OUT of the default `bun run test` gate (slower + env-specific); run via
// `bun run test:browser`. Files are named `*.browser.test.tsx` and are excluded
// from the happy-dom solid project.

/** Where the test iframe sits on the page, so a client point inside it maps to a page point. */
const iframeOffset = async (ctx: BrowserCommandContext): Promise<{ x: number; y: number }> => {
  const box = await (await (await ctx.frame()).frameElement()).boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
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

export default defineConfig({
  // Run via `--config` (not as a project), so anchor the root at this package so
  // `test/**` resolves to packages/solid/test (mirrors how the project config's
  // root is its own dir).
  root: import.meta.dirname,
  plugins: [solidPlugin()],
  resolve: {
    conditions: ["development", "browser"],
  },
  // Pre-bundled up front: Vite otherwise discovers a test's first import of it mid-run
  // and reloads the page, failing that file (the provider imports it, ADR-0021).
  optimizeDeps: {
    include: [
      "effect/Array",
      "effect/Boolean",
      "effect/Combiner",
      "effect/Equivalence",
      "effect/Function",
      "effect/Iterable",
      "effect/Latch",
      "effect/Match",
      "effect/MutableRef",
      "effect/Number",
      "effect/Order",
      "effect/Predicate",
      "effect/Record",
      "effect/Schema",
      "effect/SchemaIssue",
      "effect/SchemaTransformation",
      "effect/String",
      "effect/UndefinedOr",
      "effect/reactivity",
    ],
  },
  test: {
    name: "browser",
    include: ["test/**/*.browser.test.{ts,tsx}"],
    // The hydration tests need the hydratable compile: they're vitest.hydrate.config.ts's.
    exclude: [...configDefaults.exclude, "test/**/*.hydrate.browser.test.tsx"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers).
    setupFiles: ["./test/browser-setup.ts"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { realMouse, realTouch },
    },
  },
})
