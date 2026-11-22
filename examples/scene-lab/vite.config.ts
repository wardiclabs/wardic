import { defaultClientConditions, defineConfig } from "vite"
import { solid2 } from "../../packages/solid/vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// The scene lab (#883's PR 5c, ADR-0073 decision 29), on Solid 2, as layout-lab's v2 build is:
// `solid2()` compiles it and resolves `solid-js` and `@solidjs/web` from `packages/solid`, and Solid
// isn't pre-bundled, so its `@solidjs/web` keeps that one Solid. One copy of effect, and of three.
export default defineConfig({
  plugins: [wardicSource(), solid2()],
  resolve: {
    conditions: [...defaultClientConditions],
    dedupe: ["effect", "three"],
  },
  optimizeDeps: { exclude: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  // Served on a tailnet (`--host` its Tailscale address): its MagicDNS names, the bench box's short one and
  // the full `.ts.net` ones, which Vite 6 refuses unless told.
  server: { allowedHosts: ["wardic-bench", ".ts.net"] },
})
