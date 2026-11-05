// The core and dom references' examples typecheck (#558): every `@example` in @wardic/core's and
// @wardic/dom's doc comments is compiled beside every module of its package, so an example that calls an
// API the wrong way fails here, not in a reader's editor. A page of the reference is generated from these
// comments, a module's and, for what it re-exports, its internal files'.
//
// Each example is the body of a generator function, so it can `yield*`, with its package's modules, core's
// (for dom's), and the Effect modules the examples use imported. A name the example leaves to the reader
// (`card`, `draw`, a `Task` type) is declared `any`, as a value and a type; a misspelt member of a real
// module still fails.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const REPO = join(import.meta.dirname, "../..")

/** A package's source, its modules (`Box` for `Box.ts`), and the files its doc comments are in. */
const packageOf = (name: "core" | "dom") => {
  const src = join(REPO, "packages", name, "src")
  const modules = readdirSync(src)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .map((file) => file.slice(0, -3))
  const internal = readdirSync(join(src, "internal"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => `internal/${file}`)
  return { name, src, modules, files: [...modules.map((module) => `${module}.ts`), ...internal] }
}

const CORE = packageOf("core")
const DOM = packageOf("dom")

/** One `@example`: the file and the line its doc comment starts on, and its code. */
interface Example {
  readonly file: string
  readonly line: number
  readonly code: string
}

/** Every `@example` in `file`'s doc comments, its own `import * as X from "@wardic/…/X"` lines left out. */
const examplesOf = (src: string, file: string): ReadonlyArray<Example> => {
  const text = readFileSync(join(src, file), "utf8")
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
        file,
        line,
        code: part.split(/^@\w+/m)[0]!.replace(/^import \* as \w+ from "@wardic\/(?:core|dom)\/\w+"\n/gm, ""),
      }))
  })
}

const EFFECT = [
  `import * as Effect from "effect/Effect"`,
  `import { pipe } from "effect/Function"`,
  `import * as Layer from "effect/Layer"`,
  `import * as Option from "effect/Option"`,
  `import * as Scope from "effect/Scope"`,
  `import * as Stream from "effect/Stream"`,
  `import { Atom, AtomRegistry } from "effect/reactivity"`,
]

/** The imports an example of `pkg` sees: its own modules, core's for dom's, and Effect's. */
const headerOf = (pkg: ReturnType<typeof packageOf>): string => {
  const own = pkg.modules.map((module) => `import * as ${module} from "./${module}.ts"`)
  if (pkg.name === "core") return [...EFFECT, ...own].join("\n")
  return [...EFFECT, ...CORE.modules.map((module) => `import * as ${module} from "@wardic/core/${module}"`), ...own].join("\n")
}

/** The line the example's code starts after. */
const OPENING = "export function* example(): Generator<any, any, any> {"

/** An example's file: the imports, `declared` as `any`, and its code as a generator's body. */
const sourceOf = (header: string, code: string, declared: ReadonlySet<string>): string =>
  [header, ...[...declared].map((name) => `declare let ${name}: any\ntype ${name} = any`), OPENING, code, "}", ""].join("\n")

/** The options a package's examples compile with: dom's see the DOM's types. */
const optionsOf = (pkg: ReturnType<typeof packageOf>): ts.CompilerOptions => {
  const lib = ["lib.es2022.d.ts"]
  if (pkg.name === "dom") lib.push("lib.dom.d.ts", "lib.dom.iterable.d.ts")
  return {
    allowImportingTsExtensions: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    customConditions: ["@wardic/source"],
    target: ts.ScriptTarget.ES2022,
    lib,
    types: [],
    strict: true,
    skipLibCheck: true,
  }
}

/** The diagnostics of `files`, each a file in the package's source that exists only here, compiled together. */
const diagnosticsOf = (options: ts.CompilerOptions, files: ReadonlyMap<string, string>): ReadonlyArray<ts.Diagnostic> => {
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, version, onError, create) => {
    const text = files.get(name)
    if (text !== undefined) return ts.createSourceFile(name, text, version)
    return getSourceFile(name, version, onError, create)
  }
  host.fileExists = (name) => files.has(name) || fileExists(name)
  host.readFile = (name) => files.get(name) ?? readFile(name)
  const program = ts.createProgram([...files.keys()], options, host)
  return [...files.keys()].flatMap((name) => ts.getPreEmitDiagnostics(program, program.getSourceFile(name)))
}

/** "Cannot find name 'x'", with or without a suggestion, and a shorthand property with no value: a name left to the reader. */
const UNDECLARED = new Set([2304, 2552, 18004])

/**
 * What fails in `examples` of `pkg`, each as `file:line: message` and the line it's on: compiled once to
 * find the names each leaves to the reader, then again with those declared.
 */
const problemsOf = (pkg: ReturnType<typeof packageOf>, examples: ReadonlyArray<Example>): ReadonlyArray<string> => {
  const header = headerOf(pkg)
  const options = optionsOf(pkg)
  const fileOf = (index: number): string => join(pkg.src, `__example_${index}.ts`)
  const declared = new Map(examples.map((_, index) => [fileOf(index), new Set<string>()]))
  for (const diagnostic of diagnosticsOf(options, new Map(examples.map((example, index) => [fileOf(index), sourceOf(header, example.code, new Set())])))) {
    if (diagnostic.file === undefined || !UNDECLARED.has(diagnostic.code)) continue
    const name = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))?.[1]
    if (name !== undefined) declared.get(diagnostic.file.fileName)?.add(name)
  }
  const files = new Map(examples.map((example, index) => [fileOf(index), sourceOf(header, example.code, declared.get(fileOf(index)) ?? new Set())]))
  return diagnosticsOf(options, files).map((diagnostic) => {
    const example = examples[[...files.keys()].indexOf(diagnostic.file?.fileName ?? "")]
    if (example === undefined || diagnostic.file === undefined) return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
    const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line
    return `${pkg.name}/src/${example.file}:${example.line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}\n    ${diagnostic.file.text.split("\n")[at]?.trim() ?? ""}`
  })
}

const examplesIn = (pkg: ReturnType<typeof packageOf>): ReadonlyArray<Example> => pkg.files.flatMap((file) => examplesOf(pkg.src, file))

describe("the core and dom references' examples (#558)", () => {
  it("EX1: every example in core's doc comments typechecks", () => {
    const examples = examplesIn(CORE)
    expect(examples.length, "core's examples, found").toBeGreaterThan(100)
    expect(problemsOf(CORE, examples)).toEqual([])
  })

  it("EX2: an example that calls an API the wrong way fails", () => {
    // `springValues` takes its target, then its options: start values in the options' place don't compile.
    const wrong = { file: "Machine.ts", line: 0, code: "const card = Machine.springValues({ x: 0 }, { x: 120 })" }
    expect(problemsOf(CORE, [wrong])).toHaveLength(1)
  })

  it("EX3: every example in dom's doc comments typechecks", () => {
    const examples = examplesIn(DOM)
    expect(examples.length, "dom's examples, found").toBeGreaterThan(15)
    expect(problemsOf(DOM, examples)).toEqual([])
  })

  it("EX4: a dom example that calls an API the wrong way fails", () => {
    // `DomAnnouncer.announceIn` takes a document, then the message.
    const wrong = { file: "DomAnnouncer.ts", line: 0, code: `DomAnnouncer.announceIn("Picked up", document)` }
    expect(problemsOf(DOM, [wrong]).length).toBeGreaterThan(0)
  })
})
