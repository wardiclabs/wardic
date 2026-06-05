import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// Project config for @wardic/solid.
//
// This config's root is the package directory, so vite resolves `solid-js`
// (and its `/web` subpath) through `packages/solid/node_modules` where Bun
// symlinks it. vite-plugin-solid compiles JSX/.tsx and the happy-dom
// environment gives rendered components their DOM globals.
//
// It is referenced from the repo-root vitest.config.ts `test.projects` array,
// so `bun run test` runs it alongside the node project.
export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // happy-dom is a browser-like environment, so resolve solid-js to its
    // client build (dev.js) rather than the node/server build. Without this,
    // vitest's default `node` export condition wins and rendering throws
    // "Client-only API called on the server side".
    conditions: ["development", "browser"],
  },
  test: {
    name: "solid",
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    // Real-browser layout/projection tests run in their own project
    // (vitest.browser.config.ts); they would fail in happy-dom (no layout engine).
    exclude: ["test/**/*.browser.test.{ts,tsx}", "node_modules/**"],
    // Force solid-js to be transformed/resolved by vite (honouring the
    // browser conditions above) instead of being externalized to its node
    // build, which would re-trigger the server-side client-API error.
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
  },
})
