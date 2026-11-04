import { defaultClientConditions, defineConfig } from "vite"
import { solid2 } from "../../packages/solid/vite.solid2.ts"
import { saveLogPlugin } from "./vite.save-log.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// The lab on Solid 2 (`bun dev:v2`, #209 PR 5): the same page, its UI, probes and judging
// compiled by Solid 2, and its scenarios the Solid 2 binding's (`src/scenarios-v2`).
//
// - `solid2()` is `@wardic/solid`'s own Solid 2 compile (`@solidjs/babel-plugin`, the repo being on
//   Vite 6), and resolves `solid-js` and `@solidjs/web` from `packages/solid` for every importer:
//   one Solid 2 for the lab, the binding and `@solidjs/web` alike.
// - The `solid2` condition picks `#binding` and `#scenarios` (`package.json`'s `imports`) for it.
// - Solid isn't pre-bundled: a pre-bundled `@solidjs/web` would resolve its `solid-js` without the
//   plugin, so to Solid 1.
// - One copy of effect, as on Solid 1 (vite.config.ts).
// - Its own pre-bundle cache: sharing Solid 1's, two dev servers re-optimize each other's deps.
export default defineConfig({
  plugins: [wardicSource(), solid2(), saveLogPlugin()],
  cacheDir: "node_modules/.vite-v2",
  resolve: {
    conditions: ["solid2", ...defaultClientConditions],
    dedupe: ["effect"],
  },
  optimizeDeps: { exclude: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  build: { outDir: "dist-v2" },
})
