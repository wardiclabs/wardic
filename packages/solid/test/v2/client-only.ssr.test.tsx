// Every computation the Solid 2 binding makes is transparent to hydration ids (`CLIENT_ONLY`,
// solid-reactivity.ts): a server ward makes none, so one that took an id on the client would move the
// ids of everything after it, and hydration would miss the server's markup (#209 PR 4a; #618, decision
// 11, where an element's `loaded` memo had none). A key still loading on the client at hydration can't
// be staged: server and client would disagree on what's pending, a mismatch of its own. So the rule is
// held here, on the source: each `createMemo`, `createEffect`, `createRenderEffect`,
// `createTrackedEffect`, `createRoot`, `createProjection` and `createOptimistic`, and each
// `createSignal` of a function, passes `CLIENT_ONLY` (or a constant spreading it), but for the calls
// below, which take an id on both sides by design.
//
// - CO1: no computation in `src/unstable/v2` without CLIENT_ONLY, but the listed ones.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const DIR = join(import.meta.dirname, "../../src/unstable/v2")
const COMPUTATIONS = new Set(["createMemo", "createEffect", "createRenderEffect", "createTrackedEffect", "createRoot", "createProjection", "createOptimistic"])

/** Calls that take a hydration id on both sides by design, by file and the start of their source. */
const BOTH_SIDES: ReadonlyArray<readonly [file: string, starts: string, why: string]> = [
  ["waiters.ts", "createMemo<Events[E]>(() => from<", "`when(name)`: made in a component's body on both sides, a server's `serverWhen` in its place (#355)"],
  ["waiters.ts", "createMemo<A>(constUndefined", "`serverWhen`: the server's side of `when(name)`, adopted by the browser's (#355)"],
  ["element.tsx", "createMemo(() => render(props))", "a server element's own memo, whose id the browser's plain owner takes (AR14)"],
]

/** Whether `options`, a call's last argument, is CLIENT_ONLY, sets `transparent: true`, or is a constant of `text`'s spreading CLIENT_ONLY. */
const clientOnly = (options: ts.Expression | undefined, text: string): boolean => {
  if (options === undefined) return false
  const source = options.getText()
  if (source.includes("CLIENT_ONLY") || /transparent: true/.test(source)) return true
  if (!ts.isIdentifier(options)) return false
  const declared = new RegExp(`const ${options.text}\\b[^\\n]*CLIENT_ONLY`).test(text)
  return declared
}

describe("the Solid 2 binding's computations (#618)", () => {
  it("CO1: every computation is CLIENT_ONLY, but those that take an id on both sides by design", () => {
    const found: Array<string> = []
    for (const file of readdirSync(DIR).filter((name) => /\.tsx?$/.test(name))) {
      const text = readFileSync(join(DIR, file), "utf8")
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const name = node.expression.text
          const first = node.arguments[0]
          const ofFunction = first !== undefined && (ts.isArrowFunction(first) || ts.isFunctionExpression(first))
          const counts = COMPUTATIONS.has(name) || (name === "createSignal" && ofFunction)
          const call = node.getText()
          const listed = BOTH_SIDES.some(([where, starts]) => where === file && call.startsWith(starts))
          if (counts && !listed && !clientOnly(node.arguments[node.arguments.length - 1], text)) {
            found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${call.slice(0, 60)}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(found).toEqual([])
  })
})
