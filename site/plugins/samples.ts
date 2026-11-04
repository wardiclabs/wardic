/**
 * The docs' code samples (#558): `samples/<name>/<binding>.tsx`, real files the site's CI typechecks.
 * Imported with `?code`, a sample is its path and its source highlighted by Shiki, at build, in the
 * storefronts' two themes: `{ path, html }`. The same file imported plainly is the demo it shows.
 */
import { highlightOptions } from "@wardic/example-storefront-shared/code"
import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import { codeToHtml } from "shiki"
import type { Plugin } from "vite"

const QUERY = "?code"

export const samples = (root: string): Plugin => ({
  name: "wardic:samples",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(QUERY)) return null
    const file = id.slice(0, -QUERY.length)
    this.addWatchFile(file)
    const source = (await readFile(file, "utf8")).trimEnd()
    const html = await codeToHtml(source, highlightOptions(file))
    return `export default ${JSON.stringify({ path: relative(root, file), html })}`
  },
})
