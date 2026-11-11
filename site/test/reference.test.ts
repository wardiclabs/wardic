// The Solid reference's coverage (#558): every name either binding exports has a page, and every page
// names only what a binding exports. A page lists the exports it documents in its front matter's
// `api: [a, b]`: a new export needs a page, or a line on one, in the same PR.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const REPO = join(import.meta.dirname, "../..")
const SOLID = join(REPO, "packages/solid/src")
const REFERENCE = join(REPO, "site/src/content/reference/solid")

/** Every name `entry` exports, values and types alike, as the TypeScript compiler sees them. */
const exportsOf = (program: ts.Program, entry: string): ReadonlyArray<string> => {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  if (source === undefined) throw new Error(`no source for ${entry}`)
  const module = checker.getSymbolAtLocation(source)
  if (module === undefined) throw new Error(`no module for ${entry}`)
  return checker.getExportsOfModule(module).map((symbol) => symbol.name)
}

/** The MDX files under `dir`, at any depth. */
const pagesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pagesUnder(path)
    if (entry.name.endsWith(".mdx")) return [path]
    return []
  })

/** A page's `api` list, from its front matter: `api: [createSpring, SpringAccessor]`. */
const apiOf = (file: string): ReadonlyArray<string> => {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? ""
  const list = /^api:\s*\[([^\]]*)\]\s*$/m.exec(front)?.[1]
  if (list === undefined) return []
  return list
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
}

const program = ts.createProgram([join(SOLID, "index.tsx"), join(SOLID, "unstable/v2/index.tsx")], {
  allowImportingTsExtensions: true,
  noEmit: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
  customConditions: ["@wardic/source"],
  skipLibCheck: true,
})
const exported = new Set([...exportsOf(program, join(SOLID, "index.tsx")), ...exportsOf(program, join(SOLID, "unstable/v2/index.tsx"))])
const pages = pagesUnder(REFERENCE)
const documented = new Map(pages.flatMap((page) => apiOf(page).map((name) => [name, relative(REFERENCE, page)] as const)))

describe("the Solid reference's coverage (#558)", () => {
  it("RC1: every name either binding exports has a page", () => {
    const missing = [...exported].filter((name) => !documented.has(name)).sort()
    expect(missing, "exported, with no page in site/src/content/reference/solid").toEqual([])
  })

  it("RC2: every name a page documents is exported by a binding", () => {
    const stale = [...documented.keys()].filter((name) => !exported.has(name)).sort()
    expect(stale, "documented, but no binding exports it").toEqual([])
  })

})
