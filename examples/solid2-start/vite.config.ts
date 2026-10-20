import solid from "@solidjs/vite-plugin"
import { fileRoutes } from "filesystem-routing/vite"
import { defineConfig } from "vite"

// The Solid 2 binding's sandbox (#209 PR 4b) in @solidjs/vite-plugin's start mode, with streaming
// SSR: the plugin generates the request handler around the authored entry pair in src/
// (entry-server.tsx renders <Document><App /></Document>; entry-client.tsx hydrates it, after
// `?hydrate=<ms>`), `start.middleware` answers the API routes (src/middleware.ts), and `start.node`
// writes dist/server/node.js for `bun run start`.
export default defineConfig({
  plugins: [
    // `extensions`: the plugin also compiles the `?pick=` route modules fileRoutes emits.
    solid({ start: { node: true, middleware: "./src/middleware.ts" }, ssr: true, extensions: [".jsx", ".tsx"] }),
    // `httpMethods`: route modules may export POST (src/routes/api/save-log.ts).
    fileRoutes({ httpMethods: true, types: true }),
  ],
  resolve: {
    // @wardic/solid's source sits in packages/solid, where `solid-js` is Solid 1 (its own binding's
    // peer): resolve Solid from this app, so its Solid 2 binding runs on Solid 2.
    dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals", "effect"],
  },
  // The @wardic packages ship TypeScript source (their `exports` point at ./src): bundle them for the
  // server too, so Vite compiles them, and their `solid-js` resolves as above.
  ssr: { noExternal: ["@wardic/core", "@wardic/dom", "@wardic/solid", "@wardic/example-hand-checks"] },
  server: { port: 3000 },
  build: { target: "esnext" },
})
