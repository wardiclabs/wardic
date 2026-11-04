import { defineConfig } from "vitest/config"
import { solid2 } from "./vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Server-render tests for the Solid 2 binding, `@wardic/solid/unstable/v2` (#209): Solid 2's SSR
// compile in the `node` environment. Solid 2 and `@solidjs/web` are bundled through Vite, so their
// `solid-js` resolves to Solid 2 (vite.solid2.ts). Files are `test/v2/**/*.ssr.test.tsx`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  resolve: { dedupe: ["effect"] },
  ssr: { noExternal: [/@wardic\//, "solid-js-2", "@solidjs/web", "@solidjs/signals"] },
  test: {
    name: "v2-ssr",
    environment: "node",
    include: ["test/v2/**/*.ssr.test.tsx"],
  },
})
