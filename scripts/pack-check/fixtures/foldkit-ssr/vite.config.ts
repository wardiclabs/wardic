import { defineConfig } from "vite"

// Foldkit, server-rendered then hydrated (#794): the client build on `@wardic/foldkit`'s browser half, and
// a server build (`vite build --ssr`) that Node runs once at build time to render the page into the
// client build's `index.html`, which `vite preview` then serves as a server's response. The server build
// leaves `@wardic/*` and `foldkit` to Node, which resolves the package's `node` export condition.
export default defineConfig({})
