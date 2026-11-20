import { defineConfig } from "vitest/config"
import { Probe857 } from "./scripts/probe857-reporter.ts"

// Root config for the canonical DOM test tier — run via `bun run test:browser`.
//
// Composes the three real-browser projects so CI runs them in one pass:
//   - @wardic/dom    (packages/dom/vitest.browser.config.ts) — the DOM ports
//     against real observers / geometry / event timing.
//   - browser        (packages/solid/vitest.browser.config.ts) — `@wardic/solid`, Solid 2's binding:
//     rendered components + projection/FLIP against real layout.
//   - hydrate        (packages/solid/vitest.hydrate.config.ts) — fixtures rendered on
//     the server in Node, then hydrated in Chromium (ADR-0021).
//   - v1-browser and v1-hydrate — the Solid 1 binding's, `@wardic/solid/v1` (#566).
//   - foldkit-browser — `@wardic/foldkit`'s (#791): embedded Foldkit programs and Scene tests.
//
// The fast node tier (`bun run test`, vitest.config.ts) stays pure logic:
// @wardic/core, @wardic/test and the layout lab's classifier. Both gates must pass in CI.
export default defineConfig({
  test: {
    // PROBE #857, never merged.
    reporters: ["default", new Probe857()],
    projects: [
      "packages/dom/vitest.browser.config.ts",
      // The Solid 2 binding, `@wardic/solid` (#209, #566): in Chromium, and its server render to
      // hydration, Appear animations among them.
      "packages/solid/vitest.browser.config.ts",
      "packages/solid/vitest.hydrate.config.ts",
      // The Solid 1 binding, `@wardic/solid/v1` (#566), the same two.
      "packages/solid/vitest.browser-v1.config.ts",
      "packages/solid/vitest.hydrate-v1.config.ts",
      // The layout lab's page, mounted on either binding (#681).
      "examples/layout-lab/vitest.browser.config.ts",
      "examples/layout-lab/vitest.browser-v2.config.ts",
      // The Foldkit binding, `@wardic/foldkit` (#791, ADR-0071): every one of its tests, Scene tests too, in Chromium.
      "packages/foldkit/vitest.browser.config.ts",
      // The Foldkit binding's server render to hydration, Appear animations among them (#794).
      "packages/foldkit/vitest.hydrate.config.ts",
    ],
  },
})
