import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vite"
import { saveLogPlugin } from "./vite.save-log.ts"

// Client-only SPA: no SSR config. The @wardic/* packages ship TypeScript + Solid
// JSX source, which Vite transpiles directly in the browser build.
//
// `dedupe` keeps ONE copy of solid-js (a second copy breaks context + reactivity
// across the @wardic/solid boundary) and ONE copy of effect (a second copy would
// give the lab's Tracer Layer a different `Tracer` service key than the runtime
// that the @wardic packages build, so no span would reach it).
export default defineConfig({
  plugins: [solidPlugin(), saveLogPlugin()],
  resolve: {
    dedupe: ["solid-js", "effect"],
  },
})
