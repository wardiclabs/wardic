// The Module state rule (docs/agents/effect-first.md, "Module state and time"; #460 Q7, #618 F5): what a
// provider's Environment owns lives in its runtime, and what a package keeps at module scope says why,
// in a `// Module state (#460, Q7): …` comment just above it. Across every package's `src`:
//
// - MS1: each module-level `Map`, `WeakMap`, `Set`, `WeakSet` or `WeakRef`, and each top-level `let`, has
//   that comment in the comment block right above it. A constant typed `ReadonlySet` or `ReadonlyMap`
//   isn't state, and needs none.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const PACKAGES = join(import.meta.dirname, "../..")
const STATE = /^(export )?(const|let) \w+(: (?!Readonly(Set|Map)<)[^=]+)? = (\/\*#__PURE__\*\/ )?new (Map|WeakMap|Set|WeakSet|WeakRef)\b|^(export )?let \w+/
const COMMENT = /^(\/\/|\/\*\*| \*)/

/** Every `.ts` and `.tsx` file under `dir`. */
const filesIn = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesIn(path)
    if (/\.tsx?$/.test(name)) return [path]
    return []
  })

/** The comment block right above line `at`. */
const blockAbove = (lines: ReadonlyArray<string>, at: number): ReadonlyArray<string> => {
  const block: Array<string> = []
  for (let i = at - 1; i >= 0 && COMMENT.test(lines[i]!); i--) block.push(lines[i]!)
  return block
}

describe("module state says why (#618)", () => {
  it("MS1: every module-level collection and top-level let has its Module state comment", () => {
    const unmarked = readdirSync(PACKAGES).flatMap((pkg) => {
      const src = join(PACKAGES, pkg, "src")
      if (!statSync(join(PACKAGES, pkg)).isDirectory()) return []
      try {
        statSync(src)
      } catch {
        return []
      }
      return filesIn(src).flatMap((file) => {
        const lines = readFileSync(file, "utf8").split("\n")
        return lines.flatMap((line, i) => {
          if (!STATE.test(line)) return []
          if (blockAbove(lines, i).some((comment) => comment.includes("Module state"))) return []
          return [`${file.slice(PACKAGES.length + 1)}:${i + 1} ${line.slice(0, 80)}`]
        })
      })
    })
    expect(unmarked).toEqual([])
  })
})
