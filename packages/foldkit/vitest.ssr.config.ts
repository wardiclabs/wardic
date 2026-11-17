import { defineConfig } from "vitest/config"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Server-render test project for @wardic/foldkit (#794, ADR-0071 decisions 2 and 35; ADR-0021): Foldkit's
// `renderToString` in the `node` environment, with no `window` or `document`, as on a server. Node
// resolves the package's `node` export condition, so `@wardic/foldkit/internal/server` reads `IS_SERVER`
// true here, as a server does. Files are named `*.ssr.test.ts`; the root vitest.config.ts runs this
// project with the node tier (`bun run test`). The @wardic packages come from their sources
// (`@wardic/source`); effect stays a single copy.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource()],
  resolve: { dedupe: ["effect"] },
  ssr: { noExternal: [/@wardic\//] },
  test: {
    name: "foldkit-ssr",
    environment: "node",
    include: ["test/**/*.ssr.test.ts"],
  },
})
