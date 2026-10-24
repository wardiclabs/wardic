import { solidStart } from "@solidjs/start/config"
import { defineConfig, type Plugin } from "vite"

/**
 * `vite preview` serves compressed responses through a middleware whose `writeHead` copies headers
 * with `for…in`, as an object. SolidStart 2.1's server answers through srvx, which passes Node's
 * flat `[name, value, …]` array instead, so a compressed response's headers arrive as
 * `0: content-type`, `1: text/html`, …: the browser keeps no visitor cookie, and no server function
 * it calls decodes. So the preview serves this app uncompressed. It's the preview's alone: a
 * deployment answers through its own server.
 */
const previewUncompressed: Plugin = {
  name: "storefront:preview-uncompressed",
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      delete req.headers["accept-encoding"]
      next()
    })
  },
}

// The storefront showcase on Solid 1 (#296): SolidStart 2.1, server-rendered.
export default defineConfig({
  plugins: [solidStart({ ssr: true }), previewUncompressed],
  resolve: {
    // @wardic/solid's source sits in packages/solid, whose own `solid-js` is an older 1.9: resolve
    // Solid from this app, so the binding, the router and the app share one copy.
    dedupe: ["solid-js", "@solidjs/router", "effect"],
  },
  // The @wardic packages ship TypeScript source: bundle them for the server too, so Vite compiles them.
  ssr: { noExternal: ["@wardic/core", "@wardic/dom", "@wardic/solid", "@wardic/example-storefront-shared"] },
  server: { port: 3101 },
  preview: { port: 4101 },
  build: { target: "esnext" },
})
