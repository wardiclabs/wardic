import { defineConfig } from "vitest/config"

// Fast node test tier — run via `bun run test`.
//
// Scope: @wardic/core + @wardic/test ONLY. These are pure logic (no DOM), so
// they run in the `node` environment with no Solid JSX transform and no browser.
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
    name: "node",
    include: [
      "packages/core/test/**/*.test.ts",
      "packages/test/test/**/*.test.ts",
    ],
  },
})
