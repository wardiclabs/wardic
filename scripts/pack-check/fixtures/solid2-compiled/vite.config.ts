import { defineConfig } from "vite"

// No Solid plugin, so nothing reads the `solid` condition: `@wardic/solid`, Solid 2's binding, resolves
// to its compiled browser build, which runs as it was published (#566).
export default defineConfig({})
