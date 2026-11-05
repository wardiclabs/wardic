import { defineConfig } from "vitest/config"
import { wardicSource } from "./scripts/wardic-source.ts"

// Fast node test tier — run via `bun run test`. Two projects:
//
// - `node`: @wardic/core + @wardic/test, plus the layout lab's classifier tests
//   (examples/layout-lab/test — pure functions from a module that touches no DOM at
//   import). All of it is pure logic (no DOM), so it runs in the `node` environment
//   with no Solid JSX transform and no browser.
//   @wardic/dom's `*.node.test.ts` (its server guard and Starting-style tests, ADR-0021)
//   run here too, because they need a runtime with no DOM.
// - `ssr` (packages/solid/vitest.ssr.config.ts): @wardic/solid rendered with Solid's
//   server build in the `node` environment, as on a server (ADR-0003, ADR-0020).
//
// Everything DOM-related lives in the canonical browser tier (run via
// `bun run test:browser`, vitest.browser.config.ts):
//   - @wardic/dom    — the DOM ports against real observers / geometry / events.
//   - @wardic/solid  — rendered components + projection/FLIP against real layout.
//
// happy-dom has been retired: it has no layout engine and never fires real
// observers, so DOM behaviour can only be truly verified in a real browser. Both
// gates run in CI; both must pass. The two jsdom projects here are the docs' testing
// guide, run as a reader's own tests would, not tests of Wardic's DOM behaviour.
export default defineConfig({
  test: {
    projects: [
      {
        // `@wardic/*` from its source (#554).
        plugins: [wardicSource()],
        test: {
          name: "node",
          include: [
            "packages/core/test/**/*.test.ts",
            "packages/test/test/**/*.test.ts",
            "packages/dom/test/**/*.node.test.ts",
            "examples/layout-lab/test/**/*.test.ts",
            // The storefront showcase's store, in Effect (#296).
            "examples/storefront/shared/test/**/*.test.ts",
            // The docs site's checks: the Solid reference covers every export, and every example in
            // core's doc comments typechecks (#558).
            "site/test/**/*.test.ts",
          ],
        },
      },
      "packages/solid/vitest.ssr.config.ts",
      // The Solid 2 binding's server renders, `@wardic/solid/unstable/v2` (#209).
      "packages/solid/vitest.ssr-v2.config.ts",
      // The docs' testing guide, its samples run in jsdom as a reader's tests would (#558).
      "packages/solid/vitest.jsdom.config.ts",
      "packages/solid/vitest.jsdom-v2.config.ts",
    ],
  },
})
