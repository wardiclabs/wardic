import { join } from "node:path"
import solidPlugin from "vite-plugin-solid"
import { solid1 } from "./vite.solid1.ts"
import { defineConfig } from "vitest/config"
import { wardicSource } from "../../scripts/wardic-source.ts"
import { INSTANCE_IMPORT, instanceModule } from "../../site/test/wardic-instance.ts"

/** Where Solid 1 resolves from: this package (the site's own `solid-js` is Solid 2). */

// The docs' testing guide, run as a reader would (#558): site/samples/testing/solid1.tsx, a
// Testing Library test of `DomLive` in jsdom under Vitest's fake timers. Run with the node tier
// (`bun run test`), so the guide's recipe can't drift from what works.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid1(), solidPlugin()],
  resolve: {
    conditions: ["browser", "development"],
    dedupe: ["solid-js", "effect"],
    // The sample's Wardic instance (#516), as an app's `~/lib/wardic.ts` is.
    alias: { [INSTANCE_IMPORT]: instanceModule.solid1 },
  },
  test: {
    name: "docs-jsdom",
    dir: join(import.meta.dirname, "../../site/samples/testing"),
    include: ["solid1.tsx"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/, /@solid-primitives\//] } },
  },
})
