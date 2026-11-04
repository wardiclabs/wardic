import { solidStart } from "@solidjs/start/config"
import { defineConfig } from "vite"

// SolidStart with Solid 1, rendered on the server and hydrated, as the Solid 1 storefront is.
export default defineConfig({ plugins: [solidStart({ ssr: true })] })
