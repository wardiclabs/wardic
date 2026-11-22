import { playwright } from "@vitest/browser-playwright"
import { defaultClientConditions } from "vite"
import { defineConfig } from "vitest/config"
import { solid2 } from "../../packages/solid/vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// The scene lab's page in Chromium (#883's PR 5c), as `vite.config.ts` builds it: a card per scenario,
// each canvas drawn, and one real pointer path (ADR-0073 decision 26's browser tier).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  cacheDir: "node_modules/.vite-test",
  resolve: {
    conditions: [...defaultClientConditions],
    dedupe: ["effect", "three"],
  },
  optimizeDeps: { exclude: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  test: {
    name: "scene-lab-browser",
    include: ["test/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
})
