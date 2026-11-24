import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vite"

// `@wardic/three/solid` in a Solid 2 app on Vite, client-rendered: Solid's plugin compiles the app and
// `@wardic/solid` through its `solid` condition, the one copy `@wardic/three` takes as a peer.
export default defineConfig({ plugins: [solid()] })
