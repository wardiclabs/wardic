import { defineConfig } from "vitest/config"
import { solid2 } from "./vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// A Stage ward's tests (#884's PR 4; ADR-0073 decision 26, *Amendment (#881)* item 3, *Amendment (#884)*
// Q10): Solid 2's client build, on the `browser` condition, in Vitest's `node` environment with no DOM,
// a Stage over `@wardic/object` on frames the test pumps. Run with the node tier (`bun run test`).
const conditions = ["browser", "development"]

export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  resolve: { conditions, dedupe: ["effect"] },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    name: "stage",
    include: ["test/**/*.stage.test.tsx"],
    environment: "node",
    server: { deps: { inline: [/solid-js/, /@solidjs\//] } },
  },
})
