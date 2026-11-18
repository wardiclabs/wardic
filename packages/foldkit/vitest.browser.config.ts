import { playwright } from "@vitest/browser-playwright"
import { configDefaults, defineConfig } from "vitest/config"
import { BROWSER_COMMANDS, PREBUNDLED } from "../solid/vitest.browser-commands.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Real-browser tests for `@wardic/foldkit` (#791, ADR-0071): Foldkit programs embedded in Chromium,
// their Model changed through inbound ports and their interactions through real clicks, Scene tests
// among them (every Foldkit test runs here, but the hydrate project's, `vitest.hydrate.config.ts`).
// Files are `test/**/*.browser.test.ts`. Run via `bun run test:browser` (the root config composes
// this project with the others).

/**
 * Pre-bundled up front, as the other projects' (`vitest.browser.config.ts`): Foldkit and what it
 * imports beside Effect's modules. core's and dom's own dependencies resolve from their folders, not
 * this package's (Vite's `dep > subdep` form). The hydrate project's too (#794).
 */
export const FOLDKIT_PREBUNDLED: ReadonlyArray<string> = [...PREBUNDLED.filter((dep) => dep !== "culori/fn" && dep !== "bezier-easing"), "@wardic/dom > culori/fn", "@wardic/core > bezier-easing", "foldkit", "foldkit/brand", "foldkit/command", "foldkit/customElement", "foldkit/html", "foldkit/message", "foldkit/mount", "foldkit/port", "foldkit/render", "foldkit/runtime", "foldkit/subscription", "foldkit/test", "foldkit/devtools-host", "foldkit/scene", "effect/Schema", "effect/reactivity/Atom", "effect/reactivity/AtomRegistry", "bezier-easing"]

export default defineConfig({
  // `@wardic/*` from its source (#554).
  plugins: [wardicSource()],
  root: import.meta.dirname,
  // The package's `development` export condition (#791, Q10): development's checks are on in tests.
  resolve: { conditions: ["development", "browser"] },
  optimizeDeps: { include: [...FOLDKIT_PREBUNDLED] },
  test: {
    name: "foldkit-browser",
    include: ["test/**/*.browser.test.ts"],
    // The hydrate project's files (#794): rendered on a server first, which this project can't.
    exclude: [...configDefaults.exclude, "test/**/*.hydrate.browser.test.ts"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers), as the other projects do.
    setupFiles: ["../solid/test/browser-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      // The real-input commands the gesture fixtures use (#793, Q13): Solid's, registered here too.
      commands: BROWSER_COMMANDS,
    },
  },
})
