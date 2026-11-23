import { defineConfig } from "vitest/config"
import { solid2 } from "../solid/vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// `@wardic/three/solid`'s tests (#885; ADR-0073 decision 26, *Amendment (#881)* item 3, *Amendment (#885)*
// Q10): Solid 2's client build, on the `browser` condition, in Vitest's `node` environment with no DOM,
// on `TestStage` and stand-in renderers. `solid2()` resolves Solid from packages/solid, as the scene lab's
// build does. Run with the node tier (`bun run test`).
const conditions = ["browser", "development"]

export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  resolve: { conditions, dedupe: ["effect", "three"] },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    name: "three-solid",
    include: ["test/**/*.solid.test.tsx"],
    environment: "node",
    server: { deps: { inline: [/solid-js/, /@solidjs\//] } },
  },
})
