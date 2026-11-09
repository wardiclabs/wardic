import { playwright } from "@vitest/browser-playwright"
import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vitest/config"
import { wardicSource } from "../../scripts/wardic-source.ts"

// The lab's page in Chromium on Solid 1 (#681), as `vite.config.ts` builds it: one copy of solid-js and
// of effect. Files are `test/**/*.browser.test.tsx`; the node tier runs the lab's `*.test.ts`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solidPlugin()],
  resolve: { dedupe: ["solid-js", "effect"] },
  // Found at the first run otherwise, and a re-optimize reloads the test page mid-test.
  optimizeDeps: { include: ["@wardic/solid > @solid-primitives/refs", "effect/Combiner"] },
  test: {
    name: "layout-lab-browser",
    include: ["test/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
})
