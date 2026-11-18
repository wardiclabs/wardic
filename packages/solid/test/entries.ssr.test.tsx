// The package's three entries since 2.0 (#566), read from their source: the root, Solid 2's binding; `/v1`,
// Solid 1's, deprecated; `/unstable/v2`, the root again, deprecated. TypeScript reads `@deprecated` on an
// export specifier (not on its statement), so each deprecated name carries its own, and an editor marks the
// import.
//
// - EN1: `/unstable/v2` re-exports every name the root exports, types as types, and nothing else.
// - EN2: every name `/unstable/v2` and `/v1` export is `@deprecated`; none the root exports is.
import * as Bool from "effect/Boolean"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const SRC = join(import.meta.dirname, "../src")

/** An entry's exported names, each with whether it's type-only and whether its specifier is `@deprecated`. */
const exportsOf = (file: string): ReadonlyArray<{ readonly name: string; readonly type: boolean; readonly deprecated: boolean }> => {
  const source = ts.createSourceFile(file, readFileSync(join(SRC, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return source.statements.flatMap((statement) => {
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.map((element) => ({
        name: element.name.text,
        type: statement.isTypeOnly || element.isTypeOnly,
        deprecated: ts.getJSDocTags(element).some((tag) => tag.tagName.text === "deprecated"),
      }))
    }
    if (ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true) {
      const deprecated = ts.getJSDocTags(statement.declarationList.declarations[0]!).some((tag) => tag.tagName.text === "deprecated")
      return statement.declarationList.declarations.map((d) => ({ name: (d.name as ts.Identifier).text, type: false, deprecated }))
    }
    return []
  })
}

describe("the package's entries (#566)", () => {
  it("EN1: /unstable/v2 re-exports every name the root exports, types as types, and nothing else", () => {
    const shape = (entries: ReturnType<typeof exportsOf>) => entries.map(({ name, type }) => `${Bool.match(type, { onTrue: () => "type ", onFalse: () => "" })}${name}`).sort()
    expect(shape(exportsOf("unstable/v2/index.tsx"))).toEqual(shape(exportsOf("index.tsx")))
  })

  it("EN2: every name /unstable/v2 and /v1 export is @deprecated; none the root exports is", () => {
    const undeprecated = (file: string) => exportsOf(file).filter((entry) => !entry.deprecated).map((entry) => entry.name)
    expect(undeprecated("unstable/v2/index.tsx"), "the alias").toEqual([])
    expect(undeprecated("v1/index.tsx"), "Solid 1's").toEqual([])
    expect(exportsOf("index.tsx").filter((entry) => entry.deprecated).map((entry) => entry.name), "the root's").toEqual([])
    expect(exportsOf("v1/index.tsx").length, "Solid 1's names").toBeGreaterThan(200)
  })
})
