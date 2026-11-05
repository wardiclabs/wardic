/**
 * Each page's title (#558), by its MDX file under `src/content/`, as `virtual:page-titles`: the
 * route sets the document's title from it, while the page itself loads on its own. Read from each
 * file's front matter `title:` line, so no page's module is imported to know it.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Plugin } from "vite"

const ID = "virtual:page-titles"
const RESOLVED = `\0${ID}`

/** The MDX files under `dir`, at any depth. */
const pagesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pagesUnder(path)
    if (entry.name.endsWith(".mdx")) return [path]
    return []
  })

/** A page's front matter `title:`, unquoted, or none. */
const titleOf = (file: string): string | undefined => {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1]
  const line = /^title:\s*(.+)$/m.exec(front ?? "")?.[1]?.trim()
  if (line === undefined) return undefined
  if (/^(["']).*\1$/.test(line)) return line.slice(1, -1)
  return line
}

export const pageTitles = (content: string): Plugin => ({
  name: "wardic:page-titles",
  resolveId(id) {
    if (id === ID) return RESOLVED
    return null
  },
  load(id) {
    if (id !== RESOLVED) return null
    const titles: Record<string, string> = {}
    for (const file of pagesUnder(content)) {
      this.addWatchFile(file)
      const title = titleOf(file)
      if (title !== undefined) titles[relative(content, file).replace(/\.mdx$/, "")] = title
    }
    return `export default ${JSON.stringify(titles)}`
  },
  // A page added, removed or retitled in dev: the titles are read again.
  handleHotUpdate({ file, server }) {
    if (!file.startsWith(content) || !file.endsWith(".mdx")) return
    const module = server.moduleGraph.getModuleById(RESOLVED)
    if (module !== undefined) server.moduleGraph.invalidateModule(module)
  },
})
