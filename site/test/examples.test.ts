// The core reference's examples typecheck (#558): every `@example` in @wardic/core's doc comments is
// compiled beside every core module, so an example that calls an API the wrong way fails here, not in a
// reader's editor. A page of the reference is generated from these comments.
//
// Each example is the body of a generator function, so it can `yield*`, with core's modules and the Effect
// modules the examples use imported. A name the example leaves to the reader (`card`, `draw`, a `Task`
// type) is declared `any`, as a value and a type; a misspelt member of a real module still fails.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const REPO = join(import.meta.dirname, "../..")
const CORE = join(REPO, "packages/core/src")

/** Core's modules, `Box` for `Box.ts`. */
const modules = readdirSync(CORE)
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .map((file) => file.slice(0, -3))

/** One `@example`: the module, the line its doc comment starts on, and its code. */
interface Example {
  readonly module: string
  readonly line: number
  readonly code: string
}

/** Every `@example` in `module`'s doc comments, its own `import * as X from "@wardic/core/X"` lines left out. */
const examplesOf = (module: string): ReadonlyArray<Example> => {
  const text = readFileSync(join(CORE, `${module}.ts`), "utf8")
  return [...text.matchAll(/\/\*\*([\s\S]*?)\*\//g)].flatMap((comment) => {
    const body = comment[1]!
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .join("\n")
    const line = text.slice(0, comment.index).split("\n").length
    return body
      .split(/^@example[ \t]*\n/m)
      .slice(1)
      .map((part) => ({
        module,
        line,
        code: part.split(/^@\w+/m)[0]!.replace(/^import \* as \w+ from "@wardic\/core\/\w+"\n/gm, ""),
      }))
  })
}

const HEADER = [
  `import * as Effect from "effect/Effect"`,
  `import * as Layer from "effect/Layer"`,
  `import * as Option from "effect/Option"`,
  `import * as Scope from "effect/Scope"`,
  `import * as Stream from "effect/Stream"`,
  `import { Atom, AtomRegistry } from "effect/reactivity"`,
  ...modules.map((module) => `import * as ${module} from "./${module}.ts"`),
].join("\n")

/** The line the example's code starts after. */
const OPENING = "export function* example(): Generator<any, any, any> {"

/** An example's file: the imports, `declared` as `any`, and its code as a generator's body. */
const sourceOf = (code: string, declared: ReadonlySet<string>): string =>
  [HEADER, ...[...declared].map((name) => `declare let ${name}: any\ntype ${name} = any`), OPENING, code, "}", ""].join("\n")

const OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  noEmit: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts"],
  types: [],
  strict: true,
  skipLibCheck: true,
}

/** The diagnostics of `files`, each a file in core's source that exists only here, compiled together. */
const diagnosticsOf = (files: ReadonlyMap<string, string>): ReadonlyArray<ts.Diagnostic> => {
  const host = ts.createCompilerHost(OPTIONS)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, version, onError, create) => {
    const text = files.get(name)
    if (text !== undefined) return ts.createSourceFile(name, text, version)
    return getSourceFile(name, version, onError, create)
  }
  host.fileExists = (name) => files.has(name) || fileExists(name)
  host.readFile = (name) => files.get(name) ?? readFile(name)
  const program = ts.createProgram([...files.keys()], OPTIONS, host)
  return [...files.keys()].flatMap((name) => ts.getPreEmitDiagnostics(program, program.getSourceFile(name)))
}

/** "Cannot find name 'x'", with or without a suggestion, and a shorthand property with no value: a name left to the reader. */
const UNDECLARED = new Set([2304, 2552, 18004])

/**
 * What fails in `examples`, each as `Module.ts:line: message` and the line it's on: compiled once to
 * find the names each leaves to the reader, then again with those declared.
 */
const problemsOf = (examples: ReadonlyArray<Example>): ReadonlyArray<string> => {
  const fileOf = (index: number): string => join(CORE, `__example_${index}.ts`)
  const declared = new Map(examples.map((_, index) => [fileOf(index), new Set<string>()]))
  for (const diagnostic of diagnosticsOf(new Map(examples.map((example, index) => [fileOf(index), sourceOf(example.code, new Set())])))) {
    if (diagnostic.file === undefined || !UNDECLARED.has(diagnostic.code)) continue
    const name = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))?.[1]
    if (name !== undefined) declared.get(diagnostic.file.fileName)?.add(name)
  }
  const files = new Map(examples.map((example, index) => [fileOf(index), sourceOf(example.code, declared.get(fileOf(index)) ?? new Set())]))
  return diagnosticsOf(files).map((diagnostic) => {
    const index = [...files.keys()].indexOf(diagnostic.file?.fileName ?? "")
    const example = examples[index]
    if (example === undefined || diagnostic.file === undefined) return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
    const lines = diagnostic.file.text.split("\n")
    const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line
    return `${example.module}.ts:${example.line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}\n    ${lines[at]?.trim() ?? ""}`
  })
}

const examples = modules.flatMap(examplesOf)

describe("the core reference's examples (#558)", () => {
  it("EX1: every example in core's doc comments typechecks", () => {
    expect(examples.length, "core's examples, found").toBeGreaterThan(100)
    expect(problemsOf(examples)).toEqual([])
  })

  it("EX2: an example that calls an API the wrong way fails", () => {
    // `springValues` takes its target, then its options: start values in the options' place don't compile.
    const wrong = { module: "Machine", line: 0, code: "const card = Machine.springValues({ x: 0 }, { x: 120 })" }
    expect(problemsOf([wrong])).toHaveLength(1)
  })
})
