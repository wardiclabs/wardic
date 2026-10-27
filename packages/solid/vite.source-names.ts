// Names for the Solid 2 binding's computations, in its test runs only (#320): each `createMemo`,
// `createEffect`, `createSignal`… in `src/unstable/v2` gets a `name` of its source `file:line` and the
// variable it's assigned to, so a diagnostic or an attribution table says `ward.tsx:1187` where it
// said `effect`. Nothing ships: the package's source is unchanged, and production Solid ignores
// names anyway.
//
// The call is rewritten before the TS and JSX compile, so the lines are the source's:
// `createMemo<T>(…)` becomes `__wardicNamed("ward.tsx:816 target", "createMemo", createMemo)(…)`,
// its type arguments dropped (they're erased anyway), with `__wardicNamed` imported from
// `test/v2/source-names.ts`. Solid's own `transformSourceNames` (`@solidjs/compiler`) names only a
// primitive assigned to a variable, and most of the binding's effects are bare calls.
import { join } from "node:path"
import type { Plugin } from "vite"

const DIR = "/packages/solid/src/unstable/v2/"
const HELPER = join(import.meta.dirname, "test/v2/source-names.ts")
const PRIMITIVES = "createMemo|createEffect|createRenderEffect|createTrackedEffect|createSignal|createProjection|createReaction|createOptimistic"
/** A call of one, not a property's (`x.createEffect(`), with its type arguments if any. */
const CALL = new RegExp(`(?<![.\\w$])(${PRIMITIVES})(<[^()\\n]*>)?\\s*\\(`, "g")
/** The variable (or property) a call on this line is assigned to. */
const ASSIGNED = /(?:const|let|var)\s+(?:\[\s*)?([\w$]+)[^=\n]*=\s*$|([\w$]+)\s*[:=]\s*$/
/** A line the rewrite leaves alone: an import or export list, or a comment. */
const SKIPPED = /^\s*(import|export\s+(type\s+)?\{|\*|\/\/)/

/** Whether a line's text before a match leaves it inside a string or template literal (an error's text). */
const inString = (before: string): boolean => {
  let open: string | undefined
  for (let i = 0; i < before.length; i++) {
    const char = before[i]!
    if (char === "\\") i++
    else if (open === undefined && (char === '"' || char === "'" || char === "`")) open = char
    else if (char === open) open = undefined
  }
  return open !== undefined
}

export const sourceNames = (): Plugin => ({
  name: "wardic:source-names",
  enforce: "pre",
  transform(code, id) {
    const file = id.replace(/\?.*$/, "")
    const at = file.indexOf(DIR)
    if (at < 0 || !/\.tsx?$/.test(file)) return null
    const short = file.slice(at + DIR.length)
    let out = ""
    let last = 0
    for (const match of code.matchAll(CALL)) {
      const start = match.index
      const before = code.slice(code.lastIndexOf("\n", start - 1) + 1, start)
      if (SKIPPED.test(before) || inString(before)) continue
      const line = code.slice(0, start).split("\n").length
      const assigned = ASSIGNED.exec(before)
      const variable = assigned?.[1] ?? assigned?.[2]
      const label = [`${short}:${line}`, variable].filter((part) => part !== undefined).join(" ")
      out += `${code.slice(last, start)}__wardicNamed(${JSON.stringify(label)}, "${match[1]}", ${match[1]})(`
      last = start + match[0].length
    }
    if (last === 0) return null
    // The import goes on the first line, so every line stays where the source has it.
    return { code: `import { named as __wardicNamed } from ${JSON.stringify(HELPER)}; ${out}${code.slice(last)}`, map: null }
  },
})
