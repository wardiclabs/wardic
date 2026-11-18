import { defineConfig } from "vitest/config"
import { solid2 } from "./vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Server-render tests for the Solid 2 binding, `@wardic/solid` (#209, #566): Solid 2's SSR
// compile in the `node` environment. Solid 2 and `@solidjs/web` are bundled through Vite, so their
// `solid-js` resolves to Solid 2 (vite.solid2.ts). Files are `test/**/*.ssr.test.tsx`, but Solid 1's in `test/v1/` (#566).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  resolve: { dedupe: ["effect"] },
  ssr: { noExternal: [/@wardic\//, "solid-js", "@solidjs/web", "@solidjs/signals"] },
  test: {
    name: "ssr",
    environment: "node",
    include: ["test/**/*.ssr.test.tsx"],
    exclude: ["test/v1/**", "**/node_modules/**"],
  },
})
