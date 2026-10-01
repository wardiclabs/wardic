import { defineConfig } from "vitest/config"

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
// gates run in CI; both must pass.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "packages/core/test/**/*.test.ts",
            "packages/test/test/**/*.test.ts",
            "packages/dom/test/**/*.node.test.ts",
            "examples/layout-lab/test/**/*.test.ts",
          ],
        },
      },
      "packages/solid/vitest.ssr.config.ts",
    ],
  },
})
