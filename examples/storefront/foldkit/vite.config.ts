import { foldkit } from "@foldkit/vite-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { wardicSource } from "../../../scripts/wardic-source.ts"

// The storefront showcase on Foldkit (#795): the plugin's server-rendered build, the client and the
// server entry from one `vite build` with one build id, the dev server rendering page requests through
// the entry. `@wardic/*` from its source (#554), bundled for the server too, so Vite compiles it.
export default defineConfig({
  plugins: [wardicSource(), foldkit({ ssr: { serverEntry: "/src/entry.server.ts", clientEntry: "/src/entry.ts", build: true } })],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    // One Effect and one Foldkit: the binding's source sits in packages/foldkit, with its own copies.
    dedupe: ["effect", "foldkit", "@effect/platform-browser"],
  },
  ssr: { noExternal: ["@wardic/core", "@wardic/dom", "@wardic/foldkit", "@wardic/example-storefront-shared"] },
  optimizeDeps: { entries: ["src/entry.ts"] },
  server: { port: 3104 },
  preview: { port: 4104 },
  build: { target: "esnext" },
})
