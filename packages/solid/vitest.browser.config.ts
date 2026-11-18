import { playwright } from "@vitest/browser-playwright"
import { configDefaults, defineConfig } from "vitest/config"
import { solid2 } from "./vite.solid2.ts"
import { sourceNames } from "./vite.source-names.ts"
import { BROWSER_COMMANDS, PREBUNDLED } from "./vitest.browser-commands.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Real-browser tests for the Solid 2 binding, `@wardic/solid/unstable/v2` (#209): Solid 2's DOM
// compile in Chromium. Solid 2 and `@solidjs/web` aren't pre-bundled: served through Vite, their
// `solid-js` resolves to Solid 2 (vite.solid2.ts). Files are `test/**/*.browser.test.tsx`, but Solid 1's in `test/v1/` (#566).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), sourceNames(), solid2()],
  resolve: { conditions: ["development", "browser"] },
  optimizeDeps: { include: [...PREBUNDLED], exclude: ["solid-js", "@solidjs/web", "@solidjs/signals", "@solidjs/router"] },
  test: {
    name: "browser",
    include: ["test/**/*.browser.test.{ts,tsx}"],
    // Hydration tests run in their own project, compiled hydratable (vitest.hydrate.config.ts).
    exclude: [...configDefaults.exclude, "test/**/*.hydrate.browser.test.{ts,tsx}", "test/v1/**"],
    setupFiles: ["./test/browser-setup.ts", "./test/diagnostics-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: BROWSER_COMMANDS,
    },
  },
})
