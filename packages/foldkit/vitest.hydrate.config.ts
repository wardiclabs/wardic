import { playwright } from "@vitest/browser-playwright"
import * as Effect from "effect/Effect"
import { renderToString } from "foldkit/experimental/server"
import { configDefaults, defineConfig } from "vitest/config"
import type { BrowserCommand } from "vitest/node"
import { BROWSER_COMMANDS } from "../solid/vitest.browser-commands.ts"
import { FOLDKIT_PREBUNDLED } from "./vitest.browser.config.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Server render → hydration test project for @wardic/foldkit (#794, ADR-0071 decisions 2 and 35; ADR-0021):
// a fixture's program is rendered twice from one module. On a server, in Node, by the `serverRenderProgram`
// command below: this project's own Vite loads the module for its server environment, whose `node`
// condition has the package read `IS_SERVER` true (`@wardic/foldkit/internal/server`), so the walk at the
// Provider element's build samples the Appear animations and renders their chunk, as a server does. And in
// Chromium, where the test puts that markup on the page and hydrates it through the Handle's
// `wardic.hydrate`, which moves the chunk into the head and has the hydration render keep each element's
// running animation for its Mount's Handoff. Foldkit's `Runtime.hydrate` owns the page for its lifetime, so
// a test's program is never disposed: its host leaves the page, and the runtime idles.
//
// Files are `test/**/*.hydrate.browser.test.ts`; the root vitest.browser.config.ts runs this project with
// the others (`bun run test:browser`). Foldkit's own modules (`foldkit`, `effect`) stay external on the
// server load, as the Node tier's SSR project keeps them: one instance for the fixture's `h` and this
// file's `renderToString`, whose render frame is module-local.

/**
 * Server-render the program `exportName` of `file` (relative to this package) under `buildId`, hydratably,
 * through Foldkit's `renderToString`: the export makes a fixture record, its `program` the config. Returns
 * the markup, or the error's first line.
 */
const serverRenderProgram: BrowserCommand<[file: string, exportName: string, buildId: string]> = async (ctx, file, exportName, buildId) => {
  try {
    const mod = await ctx.project.vite.ssrLoadModule(file)
    const rendered = await Effect.runPromise(renderToString(mod[exportName]().program, { buildId }))
    return { html: rendered.html, error: "" }
  } catch (e) {
    return { html: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

export default defineConfig({
  // `@wardic/*` from its source (#554), on the client and the server alike.
  plugins: [wardicSource()],
  root: import.meta.dirname,
  // The client: the package's `development` condition (#791, Q10) and its `browser` half of the server condition.
  resolve: { conditions: ["development", "browser"] },
  // The server load: the `node` condition, so the package's server half is read, and the @wardic packages
  // bundled from their TypeScript sources; Foldkit and Effect from Node, one instance each.
  ssr: { noExternal: [/@wardic\//], resolve: { conditions: ["development", "node"] } },
  optimizeDeps: { include: [...FOLDKIT_PREBUNDLED] },
  test: {
    name: "foldkit-hydrate",
    include: ["test/**/*.hydrate.browser.test.ts"],
    // A test's first server render waits for this project's Vite to compile the fixtures for the server,
    // cold on CI while every browser project starts at once (the Solid hydrate projects' timeout).
    testTimeout: 60_000,
    exclude: [...configDefaults.exclude],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers), as the other projects do.
    setupFiles: ["../solid/test/browser-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      // Solid's commands (reduced motion emulated among them), and the server render.
      commands: { ...BROWSER_COMMANDS, serverRenderProgram },
    },
  },
})
