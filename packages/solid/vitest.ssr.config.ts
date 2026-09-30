import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// Server-render test project for @wardic/solid (ADR-0003, ADR-0020): Solid's SSR
// compile (`generate: "ssr"`) in the `node` environment, so `renderToString` runs
// solid-js's server build with no `window` or `document`, as on a server. Files are
// named `*.ssr.test.tsx`; the root vitest.config.ts runs this project with the node
// tier (`bun run test`).
//
// The @wardic packages are bundled through Vite (their sources are TypeScript + JSX);
// solid-js and effect stay single copies. The server-safe Environment is @wardic/test's
// TestLive until DomLive builds on a server (#41).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [solidPlugin({ ssr: true })],
  resolve: { dedupe: ["solid-js", "effect"] },
  ssr: { noExternal: [/@wardic\//] },
  test: {
    name: "ssr",
    environment: "node",
    include: ["test/**/*.ssr.test.tsx"],
  },
})
