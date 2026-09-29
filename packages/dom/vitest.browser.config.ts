import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

// Real-browser test project for @wardic/dom — the DOM realization of the engine's
// ports (Clock/Input/Probe/Renderer). happy-dom has no layout engine and never
// fires ResizeObserver/IntersectionObserver/matchMedia "change" or real pointer
// timing, so the old suites could only assert wiring/shape. Here Chromium
// (Playwright) gives REAL observer emissions, real geometry, and real event
// timeStamps, so the DOM ports are verified against actual browser behaviour.
//
// Browsers come from the nix devshell (PLAYWRIGHT_BROWSERS_PATH in flake.nix);
// npm `playwright` is pinned to 1.59.1 to match (chromium revision 1217).
//
// No Solid plugin here (this package has no JSX). Tests import from @effect/vitest
// and are named `*.browser.test.ts`. Run via `bun run test:browser` (the root
// browser config composes this with the @wardic/solid browser project).
export default defineConfig({
  root: import.meta.dirname,
  // Pre-bundled up front: Vite otherwise discovers a test's first import of it
  // mid-run and reloads the page once ("optimized dependencies changed. reloading").
  optimizeDeps: { include: ["effect/Tracer"] },
  test: {
    name: "dom-browser",
    include: ["test/**/*.browser.test.{ts,tsx}"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers).
    setupFiles: ["./test/browser-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
})
