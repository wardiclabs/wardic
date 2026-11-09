import { playwright } from "@vitest/browser-playwright"
import { defaultClientConditions } from "vite"
import { defineConfig } from "vitest/config"
import { solid2 } from "../../packages/solid/vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// The lab's page in Chromium on Solid 2 (#681), as `vite.v2.config.ts` builds it: the `solid2`
// condition picks `#binding` and `#scenarios`, and Solid isn't pre-bundled. The same test files as
// Solid 1's project.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  cacheDir: "node_modules/.vite-v2-test",
  resolve: {
    conditions: ["solid2", ...defaultClientConditions],
    dedupe: ["effect"],
  },
  optimizeDeps: { exclude: ["solid-js", "solid-js-2", "@solidjs/web", "@solidjs/signals"] },
  test: {
    name: "layout-lab-browser-v2",
    include: ["test/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
})
