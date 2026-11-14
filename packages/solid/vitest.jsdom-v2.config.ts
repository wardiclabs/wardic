import { join } from "node:path"
import { defineConfig } from "vitest/config"
import { solid2 } from "./vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"
import { INSTANCE_IMPORT, instanceModule } from "../../site/test/wardic-instance.ts"

// The docs' testing guide on Solid 2, run as a reader would (#558): site/samples/testing/solid2.tsx,
// `@solidjs/web`'s `render` of `DomLive` in jsdom under Vitest's fake timers. Run with the node
// tier (`bun run test`), so the guide's recipe can't drift from what works.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid2()],
  resolve: {
    conditions: ["browser", "development"],
    dedupe: ["effect"],
    // The sample's Wardic instance (#516), as an app's `~/lib/wardic.ts` is.
    alias: { [INSTANCE_IMPORT]: instanceModule.solid2 },
  },
  test: {
    name: "docs-jsdom-v2",
    dir: join(import.meta.dirname, "../../site/samples/testing"),
    include: ["solid2.tsx"],
    server: { deps: { inline: [/solid-js/, /@solidjs\//] } },
  },
})
