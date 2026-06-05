import { configDefaults, defineConfig } from "vitest/config"

// Root config for the Wardic monorepo.
//
// Tests live under each package's `test/` directory and import from
// `@effect/vitest` explicitly (no `globals: true`).
//
// We split the run into vitest projects so the Solid JSX transform stays
// scoped to @wardic/solid:
//
//   - "node": @wardic/core, @wardic/test, and @wardic/dom. The default
//     environment is `node`; @wardic/dom test files opt into happy-dom
//     per-file via a `// @vitest-environment happy-dom` docblock. No Solid
//     plugin runs here, so the JSX transform never touches these suites.
//   - "solid": @wardic/solid, defined in packages/solid/vitest.config.ts so
//     vite resolves solid-js through that package's node_modules.
//     vite-plugin-solid compiles JSX/.tsx and the environment is happy-dom so
//     rendered components have DOM globals.
//
// `vitest run` (bun run test) executes ALL projects.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "packages/core/test/**/*.test.ts",
            "packages/test/test/**/*.test.ts",
            "packages/dom/test/**/*.test.ts",
          ],
          // Real-browser DOM tests (`*.browser.test.*`) belong to the browser tier
          // (vitest.browser.config.ts), not this node project — the `*.test.ts`
          // glob would otherwise match them and run them without a layout engine.
          exclude: [...configDefaults.exclude, "**/*.browser.test.*"],
        },
      },
      "packages/solid/vitest.config.ts",
    ],
  },
})
