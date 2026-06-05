import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// Real-browser test project for @wardic/solid — layout/projection behaviours that
// happy-dom CANNOT verify (it has no layout engine, so getBoundingClientRect is
// all-zeros). Here Chromium (Playwright) gives REAL layout + real CSS transform
// composition, so projection FLIP / treeScale / relativeTarget can be asserted
// against actual measured geometry.
//
// Browsers come from the nix devshell (PLAYWRIGHT_BROWSERS_PATH, set in flake.nix
// to nixpkgs' playwright-driver.browsers — the prebuilt Playwright download fails
// on nix with a missing libnspr4.so). npm `playwright` is pinned to 1.59.1 to
// match those browsers (chromium revision 1217).
//
// Kept OUT of the default `bun run test` gate (slower + env-specific); run via
// `bun run test:browser`. Files are named `*.browser.test.tsx` and are excluded
// from the happy-dom solid project.
export default defineConfig({
  // Run via `--config` (not as a project), so anchor the root at this package so
  // `test/**` resolves to packages/solid/test (mirrors how the project config's
  // root is its own dir).
  root: import.meta.dirname,
  plugins: [solidPlugin()],
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    name: "browser",
    include: ["test/**/*.browser.test.{ts,tsx}"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers).
    setupFiles: ["./test/browser-setup.ts"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
})
