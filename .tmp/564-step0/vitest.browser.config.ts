// #881's Chromium probes (step 0 of #564): the Solid 2 binding's own browser setup (packages/solid's
// vitest.browser.config.ts), its tests swapped for this folder's.
import { join } from "node:path"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"
import { solid2 } from "../../packages/solid/vite.solid2.ts"
import { BROWSER_COMMANDS, PREBUNDLED } from "../../packages/solid/vitest.browser-commands.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

/** `@wardic/*` and `effect` for this folder, outside every package: resolved as packages/solid imports them. */
const fromSolid = () => ({
  name: "probe:from-solid",
  enforce: "pre" as const,
  async resolveId(this: { resolve: (s: string, i: string, o: object) => Promise<unknown> }, source: string, importer: string | undefined, options: object) {
    if (!/^(@wardic\/|effect(\/|$))/.test(source)) return null
    if (importer === undefined || !importer.includes("/.tmp/564-step0/")) return null
    return this.resolve(source, join(import.meta.dirname, "../../packages/solid/package.json"), { ...options, skipSelf: true })
  },
})

const SOLID = join(import.meta.dirname, "../../packages/solid")

export default defineConfig({
  root: SOLID,
  plugins: [fromSolid(), wardicSource(), solid2()],
  resolve: { conditions: ["development", "browser"] },
  optimizeDeps: { include: [...PREBUNDLED], exclude: ["solid-js", "@solidjs/web", "@solidjs/signals", "@solidjs/router"] },
  test: {
    name: "probe-881-browser",
    dir: import.meta.dirname,
    include: ["*.browser.test.tsx"],
    setupFiles: [join(SOLID, "test/browser-setup.ts")],
    browser: { enabled: true, provider: playwright(), headless: true, instances: [{ browser: "chromium" }], commands: BROWSER_COMMANDS },
  },
})
