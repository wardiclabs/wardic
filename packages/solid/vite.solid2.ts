// Solid 2 for `@wardic/solid/unstable/v2` (#209): its own JSX compile and resolution, beside the
// Solid 1 binding in the same package.
//
// - **Compile:** Solid 2's JSX transform, `@solidjs/babel-plugin` (what `@solidjs/vite-plugin` 3
//   runs, with `generate` and `hydratable` its only choices), over each `.tsx` the project
//   loads. `@solidjs/vite-plugin` itself needs Vite 8; the repo is on Vite 6.
// - **Resolve:** `solid-js` to Solid 2, aliased `solid-js-2` in this package's devDependencies,
//   for every importer, `@solidjs/web` among them: Bun installs it alone in its own folder, where
//   a plain `solid-js` would find Solid 1. Resolved as this package would import `solid-js-2`, so
//   its export conditions (browser, node, development) pick the build as they would for an app.
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "@solidjs/babel-plugin"
import { join } from "node:path"
import type { Plugin } from "vite"

/** Where `solid-js-2` resolves from: this package. */
const FROM = join(import.meta.dirname, "package.json")

/** `dev` (default `true`) keeps Solid's dev checks in the output; `bench:solid --v2` builds without them. */
export const solid2 = (options: { readonly hydratable?: boolean; readonly dev?: boolean } = {}): Plugin => ({
  name: "wardic:solid2",
  enforce: "pre",
  async resolveId(source, _importer, resolveOptions) {
    const match = /^solid-js(\/.*)?$/.exec(source)
    if (match === null) return null
    return this.resolve(`solid-js-2${match[1] ?? ""}`, FROM, { ...resolveOptions, skipSelf: true })
  },
  async transform(code, id, transformOptions) {
    if (!/\.[jt]sx$/.test(id.replace(/\?.*$/, ""))) return null
    const result = await transformAsync(code, {
      filename: id,
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      presets: [[typescript, { isTSX: true, allExtensions: true }]],
      plugins: [[solid, { generate: transformOptions?.ssr === true ? "ssr" : "dom", hydratable: options.hydratable === true, dev: options.dev !== false }]],
    })
    return result === null ? null : { code: result.code ?? "", map: result.map }
  },
})
