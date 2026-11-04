import { defineConfig } from "vite"

// No Solid plugin, so nothing reads the `solid` condition: `@wardic/solid` resolves to its compiled
// browser build, which runs as it was published.
export default defineConfig({})
