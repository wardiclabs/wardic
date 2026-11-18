import { join } from "node:path"
import solidPlugin from "vite-plugin-solid"
import { solid1 } from "./vite.solid1.ts"
import { defineConfig } from "vitest/config"
import { wardicSource } from "../../scripts/wardic-source.ts"
import { INSTANCE_IMPORT, instanceModule } from "../../site/test/wardic-instance.ts"

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
    alias: [
      { find: INSTANCE_IMPORT, replacement: instanceModule.solid1 },
      // The sample still imports `@wardic/solid`, Solid 1's entry in the published 1.x the site documents:
      // since 2.0 that's `@wardic/solid/v1` (#566), where #566's docs PR moves it, and this goes.
      { find: /^@wardic\/solid$/, replacement: "@wardic/solid/v1" },
    ],
  },
  test: {
    name: "docs-jsdom-v1",
    dir: join(import.meta.dirname, "../../site/samples/testing"),
    include: ["solid1.tsx"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/, /@solid-primitives\//] } },
  },
})
