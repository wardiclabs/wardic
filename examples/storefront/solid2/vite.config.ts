import solid from "@solidjs/vite-plugin"
import { fileRoutes } from "filesystem-routing/vite"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

// The storefront showcase on Solid 2 (#296): the plugin's start mode, generating both entries from
// src/App.tsx and src/Document.tsx, streaming server rendering, and server components (the plugin's
// spelling: `serverFunctions: { components: true }`). The middleware gives each visitor their cookie.
export default defineConfig({
  plugins: [
    solid({ start: { middleware: "./src/middleware.ts" }, ssr: true, serverFunctions: { components: true }, extensions: [".jsx", ".tsx"] }),
    fileRoutes({ types: true }),
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    // @wardic/solid's source sits in packages/solid, where `solid-js` is Solid 1 (its own binding's
    // peer): resolve Solid from this app, so its Solid 2 binding runs on Solid 2.
    dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals", "@solidjs/router", "effect"],
  },
  ssr: { noExternal: ["@wardic/core", "@wardic/dom", "@wardic/solid", "@wardic/example-storefront-shared"] },
  server: { port: 3102 },
  preview: { port: 4102 },
  build: { target: "esnext" },
})
