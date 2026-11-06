// The glossary's avoided words (#618, W1): phrases CONTEXT.md avoids that have one meaning only, so a
// hit is always a slip, never Motion's name or a quote. The rest of each _Avoid_ list is judged by hand.
// It reads the packages' sources (whose doc comments the reference is generated from), the site's own
// pages, the READMEs and docs/agents.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO = join(import.meta.dirname, "../..")

/** Each phrase, and the glossary's word for it. */
const AVOIDED: ReadonlyArray<readonly [phrase: string, use: string]> = [
  ["projection engine", "Projection system"],
  ["layout engine", "Projection system"],
  ["layout member", "Projection node"],
  ["motion component", "Complete element, or Wardic element"],
  ["SSR seed", "Starting style"],
  ["animated element", "Wardic element"],
]

/** The files under `dir` with one of `extensions`, at any depth, leaving out `skip`'s directories. */
const filesUnder = (dir: string, extensions: ReadonlyArray<string>, skip: ReadonlyArray<string> = []): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || skip.includes(path)) return []
      return filesUnder(path, extensions, skip)
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) return [path]
    return []
  })

const PACKAGES = ["core", "dom", "solid", "test"]

/** Reader-facing text: the sources, the site's hand-written pages (core's and dom's are generated from the sources), the READMEs. */
const FILES = [
  ...PACKAGES.flatMap((name) => filesUnder(join(REPO, "packages", name, "src"), [".ts", ".tsx"])),
  ...filesUnder(join(REPO, "site/src/content"), [".mdx"], [join(REPO, "site/src/content/reference/core"), join(REPO, "site/src/content/reference/dom")]),
  ...filesUnder(join(REPO, "docs/agents"), [".md"]),
  join(REPO, "README.md"),
  ...PACKAGES.map((name) => join(REPO, "packages", name, "README.md")),
]

describe("avoided words (#618)", () => {
  it("AW1: no reader-facing text uses a phrase the glossary avoids", () => {
    const hits = FILES.flatMap((file) => {
      const lines = readFileSync(file, "utf8").split("\n")
      return lines.flatMap((line, i) =>
        AVOIDED.filter(([phrase]) => line.toLowerCase().includes(phrase.toLowerCase())).map(
          ([phrase, use]) => `${relative(REPO, file)}:${i + 1}: "${phrase}" (say ${use})`,
        ),
      )
    })
    expect(hits).toEqual([])
  })
})
