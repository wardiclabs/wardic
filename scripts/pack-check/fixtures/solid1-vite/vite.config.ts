import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// Solid 1 on Vite, client-rendered: `@wardic/solid` through the `solid` condition, its JSX compiled here.
export default defineConfig({ plugins: [solid()] })
