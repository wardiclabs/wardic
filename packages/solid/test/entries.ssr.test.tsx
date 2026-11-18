// The package's three entries since 2.0 (#566), read from their source: the root, Solid 2's binding; `/v1`,
// Solid 1's, deprecated; `/unstable/v2`, the root again, deprecated. TypeScript reads `@deprecated` on an
// export specifier (not on its statement), so each deprecated name carries its own, and an editor marks the
// import.
//
// - EN1: `/unstable/v2` re-exports every name the root exports, in whatever form, types as types, and nothing else.
// - EN2: every name `/unstable/v2` and `/v1` export is `@deprecated`; none the root exports is.
import * as Bool from "effect/Boolean"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const SRC = join(import.meta.dirname, "../src")

/** Whether `node` carries the `export` modifier. */
const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)

/** Whether `node`'s JSDoc tags it `@deprecated`. */
const deprecatedIn = (node: ts.Node): boolean => ts.getJSDocTags(node).some((tag) => tag.tagName.text === "deprecated")

/**
 * An entry's exported names, each with whether it's type-only and whether it's `@deprecated`: every form a
 * name can be exported in. `export *` and a default export can't be listed name by name, so they fail here.
 */
const exportsOf = (file: string): ReadonlyArray<{ readonly name: string; readonly type: boolean; readonly deprecated: boolean }> => {
  const source = ts.createSourceFile(file, readFileSync(join(SRC, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return source.statements.flatMap((statement) => {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) throw new Error(`${file}: \`${statement.getText()}\` can't be listed name by name`)
      return statement.exportClause.elements.map((element) => ({ name: element.name.text, type: statement.isTypeOnly || element.isTypeOnly, deprecated: deprecatedIn(element) }))
    }
    if (ts.isExportAssignment(statement)) throw new Error(`${file}: a default export can't be listed name by name`)
    if (!exported(statement)) return []
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map((d) => ({ name: (d.name as ts.Identifier).text, type: false, deprecated: deprecatedIn(d) }))
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      return [{ name: statement.name?.text ?? "default", type: false, deprecated: deprecatedIn(statement) }]
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      return [{ name: statement.name.text, type: true, deprecated: deprecatedIn(statement) }]
    }
    throw new Error(`${file}: an export it doesn't read, \`${statement.getText().slice(0, 60)}\``)
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
