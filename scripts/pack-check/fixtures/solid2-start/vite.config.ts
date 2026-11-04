import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vite"

// Solid 2 in the plugin's start mode, rendered on the server and hydrated, as the Solid 2 storefront is.
export default defineConfig({ plugins: [solid({ start: {}, ssr: true })] })
