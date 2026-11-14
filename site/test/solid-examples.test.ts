// The Solid bindings' examples typecheck (#618, D8), as core's and dom's do (examples.test.ts): each tsx
// fence and `@example` in @wardic/solid's doc comments, Solid 1's (EX5) and Solid 2's, under
// `unstable/v2` (EX6), and each tsx fence on the site's own pages (EX7), compiled under its binding's JSX
// setup, so an example that names an API wrongly or gives it the wrong props fails here.
//
// A site fence that names its binding (```tsx solid1, ```tsx solid2) or imports one binding is that
// binding's; one that does neither, or imports both, is compiled under each, with the other's import
// left out. A fence names its binding where nothing it imports does: its `w` the reader's Wardic
// instance's, `~/lib/wardic.ts` (#516). An example is a snippet, not a module, so it's
// read leniently:
// - a line that starts with JSX, at its start, begins markup of its own, as the markup after a
//   component's code is in the docs, and `…` stands for code left out;
// - a parameter may be implicitly `any`;
// - a name it uses without importing is imported from its binding, `@wardic/dom` or Solid, whichever
//   exports it, and is otherwise the reader's (`items`, `save`), declared `any`;
// - a relative import is the reader's own file, and a SolidStart app's entry is left out: SolidStart
//   isn't installed here.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { INSTANCE_IMPORT, instanceModule } from "./wardic-instance.ts"

const REPO = join(import.meta.dirname, "../..")
const SITE = join(REPO, "site")

type Binding = "solid1" | "solid2"

/** One example: where it is, its code, and the bindings it's compiled under. */
interface Example {
  readonly where: string
  readonly code: string
  readonly bindings: ReadonlyArray<Binding>
}

const ENTRY: Record<Binding, string> = { solid1: "@wardic/solid", solid2: "@wardic/solid/unstable/v2" }
const OTHER: Record<Binding, Binding> = { solid1: "solid2", solid2: "solid1" }

/** The files under `dir` that `keep` keeps, at any depth. */
const filesUnder = (dir: string, keep: (path: string) => boolean): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") return []
      return filesUnder(path, keep)
    }
    if (keep(path)) return [path]
    return []
  })

/** Whether `code` imports from `binding`'s entry. */
const imports = (code: string, binding: Binding): boolean => code.includes(`from "${ENTRY[binding]}"`)

/** A site fence's bindings: the one it names, else the one it imports, else both. */
const bindingsOf = (code: string, named: string | undefined): ReadonlyArray<Binding> => {
  if (named === "solid1" || named === "solid2") return [named]
  if (imports(code, "solid1") && !imports(code, "solid2")) return ["solid1"]
  if (imports(code, "solid2") && !imports(code, "solid1")) return ["solid2"]
  return ["solid1", "solid2"]
}

/** The tsx fences on the site's own pages: core's and dom's reference is generated from their doc comments (EX1, EX3). */
const siteExamples = (): ReadonlyArray<Example> =>
  filesUnder(join(SITE, "src/content"), (path) => path.endsWith(".mdx") && !path.includes("/reference/core/") && !path.includes("/reference/dom/")).flatMap(
    (page) => {
      const text = readFileSync(page, "utf8")
      return [...text.matchAll(/```tsx(?: (solid1|solid2))?\n([\s\S]*?)```/g)]
        .filter((fence) => !fence[2]!.includes(`from "@solidjs/start`))
        .map((fence) => ({ where: `${relative(REPO, page)}:${text.slice(0, fence.index).split("\n").length}`, code: fence[2]!, bindings: bindingsOf(fence[2]!, fence[1]) }))
    },
  )

/** The examples in `binding`'s doc comments: each fence, and each `@example` with none. */
const bindingExamples = (binding: Binding): ReadonlyArray<Example> =>
  filesUnder(join(REPO, "packages/solid/src"), (path) => /\.tsx?$/.test(path) && path.includes("/unstable/v2/") === (binding === "solid2")).flatMap((file) => {
    const text = readFileSync(file, "utf8")
    return [...text.matchAll(/\/\*\*([\s\S]*?)\*\//g)].flatMap((comment) => {
      const body = comment[1]!
        .split("\n")
        .map((line) => line.replace(/^\s*\* ?/, ""))
        .join("\n")
      const where = `${relative(REPO, file)}:${text.slice(0, comment.index).split("\n").length}`
      const fenced = [...body.matchAll(/```tsx?\n([\s\S]*?)```/g)].map((fence) => fence[1]!)
      const bare = body
        .split(/^@example[ \t]*\n?/m)
        .slice(1)
        .map((part) => part.split(/^@\w+/m)[0]!)
        .filter((code) => !code.includes("```"))
      return [...fenced, ...bare].map((code) => ({ where, code, bindings: [binding] }))
    })
  })

/** A snippet as a module: its `…` comments, and each run of lines that starts with JSX at a line's start one statement. */
const asModule = (code: string): string => {
  const out: Array<string> = []
  let open = false
  for (const line of code.replace(/…/g, "/* … */").split("\n")) {
    if (open && !/^(\s|<|\}|\)|\{|$)/.test(line)) {
      out.push("</>")
      open = false
    }
    if (!open && line.startsWith("<")) {
      out.push(";<>")
      open = true
    }
    out.push(line)
  }
  if (open) out.push("</>")
  return [...out, "export {}"].join("\n")
}

/** `code` with its imports from `binding`'s entry left out. */
const withoutImportOf = (code: string, binding: Binding): string =>
  code.replace(new RegExp(`^import\\s[^;]*?from\\s+"${ENTRY[binding].replace(/[/.]/g, "\\$&")}"[^\\n]*\\n`, "gm"), "")

const SOLID1 = join(REPO, "packages/solid/node_modules/solid-js")

/** The options an example compiles with: its binding's JSX and its Solid, as the samples' tsconfigs give them. */
const optionsOf = (binding: Binding): ts.CompilerOptions => {
  // An example's `~/lib/wardic.ts` is the reader's Wardic instance (#516), as the samples' is.
  const solid2Paths: ts.MapLike<Array<string>> = {
    "solid-js": [join(SITE, "node_modules/solid-js/types/index.d.ts")],
    [INSTANCE_IMPORT]: [instanceModule.solid2],
  }
  const solid1Paths: ts.MapLike<Array<string>> = {
    "solid-js": [join(SOLID1, "types/index.d.ts")],
    "solid-js/web": [join(SOLID1, "web/types/index.d.ts")],
    "solid-js/store": [join(SOLID1, "store/types/index.d.ts")],
    "solid-js/jsx-runtime": [join(SOLID1, "types/jsx.d.ts")],
    [INSTANCE_IMPORT]: [instanceModule.solid1],
  }
  return {
    jsx: ts.JsxEmit.Preserve,
    jsxImportSource: { solid1: "solid-js", solid2: "@solidjs/web" }[binding],
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    customConditions: ["@wardic/source"],
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    noImplicitAny: false,
    skipLibCheck: true,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    paths: { solid1: solid1Paths, solid2: solid2Paths }[binding],
  }
}

/** A program over `files`, each a file that exists only here, beside the site's samples. */
const programOf = (options: ts.CompilerOptions, files: ReadonlyMap<string, string>): ts.Program => {
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, version, onError, create) => {
    const text = files.get(name)
    if (text !== undefined) return ts.createSourceFile(name, text, version, true, ts.ScriptKind.TSX)
    return getSourceFile(name, version, onError, create)
  }
  host.fileExists = (name) => files.has(name) || fileExists(name)
  host.readFile = (name) => files.get(name) ?? readFile(name)
  return ts.createProgram([...files.keys()], options, host)
}

/** `file`'s diagnostics, a compiler crash on it one more. */
const diagnosticsIn = (program: ts.Program, file: string): ReadonlyArray<ts.Diagnostic | string> => {
  try {
    return ts.getPreEmitDiagnostics(program, program.getSourceFile(file))
  } catch (error) {
    return [`the compiler crashed on it: ${String(error).slice(0, 120)}`]
  }
}

/** What an example can use without importing it, by where it comes from: its binding, `@wardic/dom` and its Solid. */
const sourcesOf = (binding: Binding): ReadonlyArray<readonly [from: string, names: ReadonlySet<string>]> => {
  const froms = [ENTRY[binding], "@wardic/dom", "solid-js", ...{ solid1: ["solid-js/web"], solid2: ["@solidjs/web"] }[binding]]
  const probe = join(SITE, "samples", "__sources.tsx")
  const program = programOf(optionsOf(binding), new Map([[probe, froms.map((from, i) => `import * as M${i} from "${from}"`).join("\n")]]))
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(probe)!
  return froms.map((from, i) => {
    const module = checker.getSymbolAtLocation((source.statements[i] as ts.ImportDeclaration).moduleSpecifier)
    if (module === undefined) throw new Error(`no module ${from}`)
    return [from, new Set(checker.getExportsOfModule(module).map((symbol) => symbol.name))] as const
  })
}

/** "Cannot find name 'x'", with or without a suggestion, and a shorthand property with no value: a name the example doesn't import. */
const UNDECLARED = new Set([2304, 2552, 18004])
/** "Cannot find module": for a relative import, the reader's own file. */
const NO_MODULE = 2307

/** What fails in `examples` under `binding`, each as `where: message` and its line. */
const problemsOf = (binding: Binding, examples: ReadonlyArray<Example>): ReadonlyArray<string> => {
  const options = optionsOf(binding)
  const sources = sourcesOf(binding)
  const fileOf = (index: number): string => join(SITE, "samples", `__example_${binding}_${index}.tsx`)
  const codes = examples.map((example) => asModule(withoutImportOf(example.code, OTHER[binding])))
  const first = programOf(options, new Map(codes.map((code, index) => [fileOf(index), code])))
  const files = new Map(
    codes.map((code, index) => {
      const names = new Set<string>()
      for (const diagnostic of diagnosticsIn(first, fileOf(index))) {
        if (typeof diagnostic === "string" || !UNDECLARED.has(diagnostic.code)) continue
        const name = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))?.[1]
        if (name !== undefined) names.add(name)
      }
      const header = [...names].map((name) => {
        const from = sources.find(([, exported]) => exported.has(name))
        if (from === undefined) return `declare let ${name}: any\ntype ${name} = any`
        return `import { ${name} } from "${from[0]}"`
      })
      return [fileOf(index), [...header, code].join("\n")] as const
    }),
  )
  const program = programOf(options, files)
  return [...files.keys()].flatMap((file, index) =>
    diagnosticsIn(program, file).flatMap((diagnostic) => {
      const where = examples[index]!.where
      if (typeof diagnostic === "string") return [`${where}: ${diagnostic}`]
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
      if (diagnostic.code === NO_MODULE && /'\.\.?\//.test(message)) return []
      const line = diagnostic.file?.text.split("\n")[diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line]?.trim() ?? ""
      return [`${where} (${binding}): ${message}\n    ${line}`]
    }),
  )
}

/** What fails in `examples`, each compiled under its bindings. */
const problemsIn = (examples: ReadonlyArray<Example>): ReadonlyArray<string> =>
  (["solid1", "solid2"] as const).flatMap((binding) => {
    const mine = examples.filter((example) => example.bindings.includes(binding))
    if (mine.length === 0) return []
    return problemsOf(binding, mine)
  })

describe("the Solid bindings' examples (#618)", () => {
  it("EX5: every example in Solid 1's doc comments typechecks", { timeout: 120_000 }, () => {
    const examples = bindingExamples("solid1")
    expect(examples.length, "Solid 1's examples, found").toBeGreaterThan(50)
    expect(problemsIn(examples)).toEqual([])
  })

  it("EX6: every example in Solid 2's doc comments typechecks", { timeout: 120_000 }, () => {
    const examples = bindingExamples("solid2")
    expect(examples.length, "Solid 2's examples, found").toBeGreaterThan(40)
    expect(problemsIn(examples)).toEqual([])
  })

  it("EX7: every tsx fence on the site's pages typechecks, under each binding it's for", { timeout: 120_000 }, () => {
    const examples = siteExamples()
    expect(examples.length, "the site's fences, found").toBeGreaterThan(80)
    expect(problemsIn(examples)).toEqual([])
  })

  it("EX8: an example that gives an API the wrong props, or names it wrongly, fails", { timeout: 120_000 }, () => {
    const wrong: ReadonlyArray<Example> = [
      { where: "wrong-prop", code: `<w.div animate={{ opacity: "none" }} whileHover={42} />`, bindings: ["solid1"] },
      { where: "wrong-name", code: `const card = w.ward()`, bindings: ["solid1"] },
      { where: "whole-accessor", code: `const list = reorderGroup(() => ({ values: items(), onReorder: setItems }))`, bindings: ["solid2"] },
    ]
    const problems = problemsIn(wrong)
    expect(problems.some((problem) => problem.startsWith("wrong-prop")), "a wrong prop").toBe(true)
    expect(problems.some((problem) => problem.startsWith("wrong-name")), "Solid 1 has no w.ward").toBe(true)
    expect(problems.some((problem) => problem.startsWith("whole-accessor")), "reorderGroup takes its config per key").toBe(true)
  })
})
