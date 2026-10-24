import { solidStart } from "@solidjs/start/config"
import { defineConfig } from "vite"

// The storefront showcase on Solid 1 (#296): SolidStart 2.1, server-rendered.
export default defineConfig({
  plugins: [solidStart({ ssr: true })],
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
