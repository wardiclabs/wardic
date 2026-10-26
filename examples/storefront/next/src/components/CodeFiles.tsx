/**
 * An example's code (#366 Q5), as a server component: every file in its folder, its `Demo.tsx` first,
 * highlighted on the server, so the browser downloads neither the source nor the highlighter.
 */
import { highlightOptions, inShowingOrder } from "@wardic/example-storefront-shared/code"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { codeToHtml } from "shiki"

const SRC = join(process.cwd(), "src")

export async function CodeFiles({ id }: { readonly id: string }) {
  const names = await readdir(join(SRC, "examples", id))
  const paths = inShowingOrder(names.map((name) => `examples/${id}/${name}`))
  const files = await Promise.all(paths.map(async (path) => ({ path, html: await codeToHtml(await readFile(join(SRC, path), "utf8"), highlightOptions(path)) })))
  return files.map((file) => (
    <div key={file.path} className="code-file">
      <header>{file.path}</header>
      <div dangerouslySetInnerHTML={{ __html: file.html }} />
    </div>
  ))
}
