/**
 * Each page's title and description (#558), by its MDX file under `src/content/`, as
 * `virtual:page-titles` and `virtual:page-descriptions`: the route sets the document's head from them,
 * while the page itself loads on its own. Read from each file's front matter `title:` and
 * `description:` lines, so no page's module is imported to know them. The prerender reads them the same
 * way, for the sitemap and `llms.txt`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Plugin } from "vite"

/** Each virtual module, by its id: the front matter field it holds. */
const FIELDS: Readonly<Record<string, string>> = {
  "virtual:page-titles": "title",
  "virtual:page-descriptions": "description",
}

/** The MDX files under `dir`, at any depth. */
export const pagesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pagesUnder(path)
    if (entry.name.endsWith(".mdx")) return [path]
    return []
  })

/** A page's front matter `field:`, unquoted, or none. */
export const frontOf = (file: string, field: string): string | undefined => {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1]
  const line = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(front ?? "")?.[1]?.trim()
  if (line === undefined) return undefined
  if (/^(["']).*\1$/.test(line)) return line.slice(1, -1)
  return line
}

/** Each page's front matter `field:`, by its path under `content` without `.mdx`: `index`, `guides/layout`. */
export const fieldOfPages = (content: string, field: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const file of pagesUnder(content)) {
    const value = frontOf(file, field)
    if (value !== undefined) values[relative(content, file).replace(/\.mdx$/, "")] = value
  }
  return values
}

export const pageFrontMatter = (content: string): Plugin => ({
  name: "wardic:page-front-matter",
  resolveId(id) {
    if (id in FIELDS) return `\0${id}`
    return null
  },
  load(id) {
    const field = FIELDS[id.slice(1)]
    if (!id.startsWith("\0") || field === undefined) return null
    for (const file of pagesUnder(content)) this.addWatchFile(file)
    return `export default ${JSON.stringify(fieldOfPages(content, field))}`
  },
  // A page added, removed or edited in dev: its fields are read again.
  handleHotUpdate({ file, server }) {
    if (!file.startsWith(content) || !file.endsWith(".mdx")) return
    for (const id of Object.keys(FIELDS)) {
      const module = server.moduleGraph.getModuleById(`\0${id}`)
      if (module !== undefined) server.moduleGraph.invalidateModule(module)
    }
  },
})
