import { defineConfig } from "vitest/config"

// Root config for the canonical DOM test tier — run via `bun run test:browser`.
//
// Composes the two real-browser projects so CI runs both in one pass:
//   - @wardic/dom    (packages/dom/vitest.browser.config.ts) — the DOM ports
//     against real observers / geometry / event timing.
//   - @wardic/solid  (packages/solid/vitest.browser.config.ts) — rendered
//     components + projection/FLIP against real layout (vite-plugin-solid).
//
// The fast node tier (`bun run test`, vitest.config.ts) stays @wardic/core +
// @wardic/test only. Both gates must pass in CI.
export default defineConfig({
  test: {
    projects: [
      "packages/dom/vitest.browser.config.ts",
      "packages/solid/vitest.browser.config.ts",
    ],
  },
})
