// Solid 1 for the Solid 1 binding (#566): its resolution, beside the Solid 2 binding in the same package.
//
// - **Resolve:** `solid-js` and Solid 1's router to the `solid-js-1` and `@solidjs/router-1` aliases in this
//   package's devDependencies, for every importer: this package's own `solid-js` is Solid 2.
//   - Its `resolveId` takes each name, aliased or not, to the alias as this package would import it, so
//     its export conditions (browser, node, development) pick the build as they would for an app.
//   - Its `alias` and `dedupe` reach what Vite's dependency pre-bundling resolves without plugins:
//     vite-plugin-solid's own `solid-js/web`, `@solidjs/testing-library`'s and `@solid-primitives/refs`'
//     `solid-js`, each to the alias at the project's root. Only when Vite serves (the test projects): a
//     build pre-bundles nothing, and the bench's and `size`'s base side has no alias at its root.
//   - A dependency Node loads on a server (a test project's externals) never comes here: inline it.
// - **Compile:** vite-plugin-solid's (`babel-preset-solid`), given beside it.
//
// The mirror of `vite.solid2.ts`'s resolution, which once mapped `solid-js` to a `solid-js-2` alias the
// other way round. It goes with the Solid 1 binding.
import { join } from "node:path"
import type { Plugin } from "vite"

/** Where the aliases resolve from: this package. */
const FROM = join(import.meta.dirname, "package.json")

/** Each Solid 1 package this package holds under an alias, by the name an importer gives it. */
const ALIAS: Readonly<Record<string, string>> = {
  "solid-js": "solid-js-1",
  "solid-js-1": "solid-js-1",
  "@solidjs/router": "@solidjs/router-1",
  "@solidjs/router-1": "@solidjs/router-1",
}

/** The plugin: `solid-js` and `@solidjs/router` (and their subpaths) to their Solid 1 aliases. */
export const solid1 = (): Plugin => ({
  name: "wardic:solid1",
  enforce: "pre",
  config: (_config, { command }) => {
    if (command !== "serve") return undefined
    return {
      resolve: {
        alias: [
          { find: /^solid-js(?=\/|$)/, replacement: "solid-js-1" },
          { find: /^@solidjs\/router(?=\/|$)/, replacement: "@solidjs/router-1" },
        ],
        dedupe: ["solid-js-1", "@solidjs/router-1"],
      },
    }
  },
  async resolveId(source, _importer, options) {
    const match = /^(solid-js-1|solid-js|@solidjs\/router-1|@solidjs\/router)(\/.*)?$/.exec(source)
    if (match === null) return null
    return this.resolve(`${ALIAS[match[1]!]}${match[2] ?? ""}`, FROM, { ...options, skipSelf: true })
  },
})
