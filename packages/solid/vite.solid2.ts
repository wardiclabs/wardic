// Solid 2 for the Solid 2 binding (#209, #566): its own JSX compile and resolution, beside the
// Solid 1 binding in the same package.
//
// - **Compile:** Solid 2's JSX transform, `@solidjs/babel-plugin` (what `@solidjs/vite-plugin` 3
//   runs, with `generate` and `hydratable` its only choices), over each `.tsx` the project
//   loads. `@solidjs/vite-plugin` itself needs Vite 8; the repo is on Vite 6.
// - **Resolve:** `solid-js` and `@solidjs/web` from this package, Solid 2's, for every importer:
//   an app outside it (the layout lab's Solid 2 build, #209 PR 5) gets the one copy the binding
//   imports, and `bench:solid`'s and `size`'s base side the working tree's. Resolved as this
//   package would import them, so their export conditions (browser, node, development) pick the
//   build as they would for an app. Solid 1 is `vite.solid1.ts`'s, under its `solid-js-1` alias.
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "@solidjs/babel-plugin"
import { join } from "node:path"
import type { Plugin } from "vite"

/** Where Solid 2 resolves from: this package. */
const FROM = join(import.meta.dirname, "package.json")

/** `dev` (default `true`) keeps Solid's dev checks in the output; `bench:solid --v2` builds without them. */
export const solid2 = (options: { readonly hydratable?: boolean; readonly dev?: boolean } = {}): Plugin => ({
  name: "wardic:solid2",
  enforce: "pre",
  async resolveId(source, _importer, resolveOptions) {
    if (!/^(solid-js|@solidjs\/web)(\/.*)?$/.test(source)) return null
    return this.resolve(source, FROM, { ...resolveOptions, skipSelf: true })
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
