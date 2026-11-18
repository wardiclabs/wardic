import solidPlugin from "vite-plugin-solid"
import { solid1 } from "./vite.solid1.ts"
import { defineConfig } from "vitest/config"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Server-render test project for @wardic/solid (ADR-0003, ADR-0020): Solid's SSR
// compile (`generate: "ssr"`) in the `node` environment, so `renderToString` runs
// solid-js's server build with no `window` or `document`, as on a server. Files are
// named `*.ssr.test.tsx`; the root vitest.config.ts runs this project with the node
// tier (`bun run test`).
//
// The @wardic packages are bundled through Vite (their sources are TypeScript + JSX);
// solid-js and effect stay single copies. The Environment is DomLive: a server render
// builds no runtime (ADR-0021).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid1(), solidPlugin({ ssr: true })],
  resolve: { dedupe: ["solid-js", "effect"] },
  // Processed here, not by Node: their `solid-js` then goes through `solid1()`, to Solid 1 (#566).
  ssr: { noExternal: [/@wardic\//, /@solid-primitives\//] },
  test: {
    name: "v1-ssr",
    environment: "node",
    include: ["test/v1/**/*.ssr.test.tsx"],
    // The Solid 2 binding's are vitest.ssr.config.ts's (#566).
    exclude: ["**/node_modules/**"],
  },
})
