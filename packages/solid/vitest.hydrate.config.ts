import { playwright } from "@vitest/browser-playwright"
import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vitest/config"
import type { BrowserCommand } from "vitest/node"

// Server render → hydration test project for @wardic/solid (ADR-0021, decision 10).
//
// A fixture is rendered twice from one module: on the server, in Node, by the
// `serverRender` command below (the project's own Vite loads it with Solid's server
// build), and in Chromium, where the test hydrates that markup with the hydratable client
// build. `solidPlugin({ ssr: true })` compiles both: `generate: "ssr"` for the server
// load, hydratable DOM code for the browser. The plain solid browser project compiles
// non-hydratable code, so it excludes these files.
//
// Solid 1.9.13 doesn't report most hydration mismatches (a different tag under the same
// key claims the server's node; a different style is patched), so the tests compare the
// markup and the nodes themselves.
//
// Files are `test/**/*.hydrate.browser.test.tsx`; the root vitest.browser.config.ts runs
// this project with the other two (`bun run test:browser`).

/**
 * Server-render `exportName` from `file` (relative to this package) with Solid's server
 * build, under `renderId` so fixtures sharing one page don't share hydration keys. Returns
 * the markup and the hydration script, or the error's first line.
 */
const serverRender: BrowserCommand<[file: string, exportName: string, renderId: string]> = async (
  ctx,
  file,
  exportName,
  renderId,
) => {
  const vite = ctx.project.vite
  const web = await vite.ssrLoadModule("solid-js/web")
  try {
    const mod = await vite.ssrLoadModule(file)
    const html: string = web.renderToString(() => mod[exportName](), { renderId })
    return { html, script: web.generateHydrationScript() as string, error: "" }
  } catch (e) {
    return { html: "", script: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

/** Emulate `prefers-reduced-motion: reduce` (or clear it) on the test page and its frames. */
const emulateReducedMotion: BrowserCommand<[reduce: boolean]> = async (ctx, reduce) => {
  await ctx.page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" })
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [solidPlugin({ ssr: true })],
  resolve: {
    conditions: ["development", "browser"],
    dedupe: ["solid-js", "effect"],
  },
  // The @wardic packages ship TypeScript + JSX source: bundle them for the server load too.
  ssr: { noExternal: [/@wardic\//] },
  // Pre-bundled up front, as the dom project does: a first import mid-run reloads the page.
  optimizeDeps: {
    include: [
      "effect/Array",
      "effect/Boolean",
      "effect/Equivalence",
      "effect/Function",
      "effect/Latch",
      "effect/Logger",
      "effect/Match",
      "effect/MutableRef",
      "effect/Number",
      "effect/Order",
      "effect/Predicate",
      "effect/Record",
      "effect/References",
      "effect/String",
      "effect/UndefinedOr",
    ],
  },
  test: {
    name: "hydrate",
    include: ["test/**/*.hydrate.browser.test.tsx"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers).
    setupFiles: ["./test/browser-setup.ts"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { emulateReducedMotion, serverRender },
    },
  },
})
