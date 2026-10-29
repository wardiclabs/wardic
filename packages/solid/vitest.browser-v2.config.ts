import { playwright } from "@vitest/browser-playwright"
import { configDefaults, defineConfig } from "vitest/config"
import { solid2 } from "./vite.solid2.ts"
import { sourceNames } from "./vite.source-names.ts"
import { BROWSER_COMMANDS, PREBUNDLED } from "./vitest.browser.config.ts"

// Real-browser tests for the Solid 2 binding, `@wardic/solid/unstable/v2` (#209): Solid 2's DOM
// compile in Chromium. Solid 2 and `@solidjs/web` aren't pre-bundled: served through Vite, their
// `solid-js` resolves to Solid 2 (vite.solid2.ts). Files are `test/v2/**/*.browser.test.tsx`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [sourceNames(), solid2()],
  resolve: { conditions: ["development", "browser"] },
  optimizeDeps: { include: [...PREBUNDLED], exclude: ["solid-js-2", "@solidjs/web", "@solidjs/signals", "@solidjs/router-2"] },
  test: {
    name: "v2-browser",
    include: ["test/v2/**/*.browser.test.{ts,tsx}"],
    // Hydration tests run in their own project, compiled hydratable (vitest.hydrate-v2.config.ts).
    exclude: [...configDefaults.exclude, "test/v2/**/*.hydrate.browser.test.{ts,tsx}"],
    setupFiles: ["./test/browser-setup.ts", "./test/v2/diagnostics-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: BROWSER_COMMANDS,
    },
  },
})
