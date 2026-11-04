import { join } from "node:path"
import type { Plugin } from "vite"
import solidPlugin from "vite-plugin-solid"
import { defineConfig } from "vitest/config"
import { wardicSource } from "../../scripts/wardic-source.ts"

/** Where Solid 1 resolves from: this package (the site's own `solid-js` is Solid 2). */
const FROM = join(import.meta.dirname, "package.json")

/** Every importer's `solid-js` to Solid 1, as this package would import it: the samples sit in the site. */
const solid1: Plugin = {
  name: "wardic:solid1",
  enforce: "pre",
  resolveId(source, _importer, options) {
    if (!/^solid-js(\/.*)?$/.test(source)) return null
    return this.resolve(source, FROM, { ...options, skipSelf: true })
  },
}

// The docs' testing guide, run as a reader would (#558): site/samples/testing/solid1.tsx, a
// Testing Library test of `DomLive` in jsdom under Vitest's fake timers. Run with the node tier
// (`bun run test`), so the guide's recipe can't drift from what works.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solid1, solidPlugin()],
  resolve: { conditions: ["browser", "development"], dedupe: ["solid-js", "effect"] },
  test: {
    name: "docs-jsdom",
    dir: join(import.meta.dirname, "../../site/samples/testing"),
    include: ["solid1.tsx"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
  },
})
