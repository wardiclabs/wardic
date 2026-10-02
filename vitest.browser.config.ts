import { defineConfig } from "vitest/config"

// Root config for the canonical DOM test tier — run via `bun run test:browser`.
//
// Composes the three real-browser projects so CI runs them in one pass:
//   - @wardic/dom    (packages/dom/vitest.browser.config.ts) — the DOM ports
//     against real observers / geometry / event timing.
//   - @wardic/solid  (packages/solid/vitest.browser.config.ts) — rendered
//     components + projection/FLIP against real layout (vite-plugin-solid).
//   - hydrate        (packages/solid/vitest.hydrate.config.ts) — fixtures rendered on
//     the server in Node, then hydrated in Chromium (ADR-0021).
//
// The fast node tier (`bun run test`, vitest.config.ts) stays pure logic:
// @wardic/core, @wardic/test and the layout lab's classifier. Both gates must pass in CI.
export default defineConfig({
  test: {
    projects: [
      "packages/dom/vitest.browser.config.ts",
      "packages/solid/vitest.browser.config.ts",
      "packages/solid/vitest.hydrate.config.ts",
    ],
  },
})
