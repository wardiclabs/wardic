/**
 * `bun run build` (#554): the four packages' published output, one file per source module, never
 * bundled, so an app's bundler splits Wardic's modules as it splits its own (ADR-0067, *Amendment
 * (#548)*).
 *
 * 1. `tsc --build`: `core`, `dom` and `test` into `dist/` (ESM `.js`, `.d.ts`, maps), and
 *    `@wardic/solid`'s Solid 1 binding into `dist/solid/`, its JSX kept as JSX: the `solid` export
 *    condition, which Vite and SolidStart compile with the app's own settings.
 * 2. `tsc --build tsconfig.v2.build.json`: the Solid 2 binding, `src/unstable/v2`, the same way.
 * 3. Babel over `dist/solid/`: each module compiled for the browser (`dist/browser/`) and for the
 *    server (`dist/server/`), hydratable, for a tool that doesn't read the `solid` condition. Solid
 *    1's compiler for the root entry, Solid 2's for `unstable/v2`, without its dev checks. A `.jsx`
 *    module becomes `.js`, and the imports of it follow. Each map chains to `tsc`'s, so it still
 *    points into `src/`.
 *
 *   bun scripts/build-packages.ts
 */
import type { PluginObj, types } from "@babel/core"
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { createRequire } from "node:module"

const ROOT = join(import.meta.dirname, "..")
const SOLID = join(ROOT, "packages", "solid")
const TSC = join(ROOT, "node_modules", "typescript-7", "bin", "tsc")
// Babel and both compilers from `@wardic/solid`'s devDependencies: Solid 1's preset, Solid 2's plugin.
const requireFromSolid = createRequire(join(SOLID, "package.json"))
const { transformAsync } = requireFromSolid("@babel/core") as typeof import("@babel/core")
const solid1Preset = requireFromSolid("babel-preset-solid")
const solid2Plugin = requireFromSolid("@solidjs/babel-plugin")

/** What each compiled target is: its folder, and the compilers' `generate`. */
const TARGETS = [
  { dir: "browser", generate: "dom" },
  { dir: "server", generate: "ssr" },
] as const

/** Every file under `dir`, recursively. */
const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return [path]
  })

/** A relative import of a `.jsx` module, whose compiled form is `.js`. */
const JSX_IMPORT = /^\.{1,2}\/.*\.jsx$/

/** Rewrites each relative `.jsx` import, static or dynamic, re-export included, to `.js`. */
const jsxImportsToJs = (): PluginObj => {
  const rewrite = (source: types.StringLiteral | null | undefined): void => {
    if (source !== null && source !== undefined && JSX_IMPORT.test(source.value)) source.value = source.value.replace(/\.jsx$/, ".js")
  }
  return {
    name: "wardic:jsx-imports-to-js",
    visitor: {
      ImportDeclaration: (path) => rewrite(path.node.source),
      ExportNamedDeclaration: (path) => rewrite(path.node.source),
      ExportAllDeclaration: (path) => rewrite(path.node.source),
      CallExpression: (path) => {
        const [first] = path.node.arguments
        if (path.node.callee.type === "Import" && first?.type === "StringLiteral") rewrite(first)
      },
    },
  }
}

/** One module of `dist/solid/` compiled for `target`, into its folder. */
const compile = async (file: string, target: (typeof TARGETS)[number]): Promise<void> => {
  const rel = relative(join(SOLID, "dist", "solid"), file)
  const v2 = rel.startsWith(join("unstable", "v2"))
  const code = readFileSync(file, "utf8").replace(/\n\/\/# sourceMappingURL=.*$/, "")
  const inputSourceMap = JSON.parse(readFileSync(`${file}.map`, "utf8"))
  let compiler: object = { presets: [[solid1Preset, { generate: target.generate, hydratable: true }]], plugins: [jsxImportsToJs] }
  if (v2) compiler = { plugins: [[solid2Plugin, { generate: target.generate, hydratable: true, dev: false }], jsxImportsToJs] }
  const result = await transformAsync(code, { filename: file, babelrc: false, configFile: false, sourceMaps: true, inputSourceMap, ...compiler })
  if (result?.code === null || result?.code === undefined) throw new Error(`build: Babel gave nothing for ${rel}`)
  const out = join(SOLID, "dist", target.dir, rel.replace(/\.jsx$/, ".js"))
  mkdirSync(dirname(out), { recursive: true })
  const name = out.slice(dirname(out).length + 1)
  writeFileSync(out, `${result.code}\n//# sourceMappingURL=${name}.map\n`)
  // The map's sources stay `tsc`'s, relative to a file at the same depth under `dist/`.
  writeFileSync(`${out}.map`, JSON.stringify({ ...result.map, file: name }))
}

const run = (args: ReadonlyArray<string>): void => {
  execFileSync(TSC, args, { cwd: ROOT, stdio: "inherit" })
}

run(["--build"])
run(["--build", join(SOLID, "tsconfig.v2.build.json")])
for (const target of TARGETS) rmSync(join(SOLID, "dist", target.dir), { recursive: true, force: true })
const modules = filesUnder(join(SOLID, "dist", "solid")).filter((file) => /\.jsx?$/.test(file))
await Promise.all(TARGETS.flatMap((target) => modules.map((file) => compile(file, target))))
console.log(`build: ${modules.length} @wardic/solid modules, compiled for ${TARGETS.map((t) => t.dir).join(" and ")}`)
