import solid from "@solidjs/vite-plugin"
import { fileRoutes } from "filesystem-routing/vite"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { wardicSource } from "../../../scripts/wardic-source.ts"

// The storefront showcase on Solid 2 (#296): the plugin's start mode, generating both entries from
// src/App.tsx and src/Document.tsx, streaming server rendering, and server components (the plugin's
// spelling: `serverFunctions: { components: true }`). The middleware gives each visitor their cookie;
// the client setup holds hydration when a page's `?hydrate=` asks (#388).
export default defineConfig({
  plugins: [
    // `@wardic/*` from its source (#554).
    wardicSource(),
    solid({ start: { middleware: "./src/middleware.ts", clientSetup: "./src/client-setup.ts" }, ssr: true, serverFunctions: { components: true }, extensions: [".jsx", ".tsx"] }),
    fileRoutes({ types: true }),
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    // @wardic/solid's source sits in packages/solid, where `solid-js` is Solid 1 (its own binding's
    // peer): resolve Solid from this app, so its Solid 2 binding runs on Solid 2. Not
    // `@solidjs/signals`, which the app doesn't declare: dedupe resolves from the app's root, and once
    // `@solidjs/diagnostics` (a devDependency, #460) has the dev server externalize signals, the
    // server render can't find it there. Every importer reaches the one copy beside `solid-js`.
    dedupe: ["solid-js", "@solidjs/web", "@solidjs/router", "effect"],
  },
  ssr: { noExternal: ["@wardic/core", "@wardic/dom", "@wardic/solid", "@wardic/example-storefront-shared"] },
  server: { port: 3102 },
  preview: { port: 4102 },
  build: { target: "esnext" },
})
