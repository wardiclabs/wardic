/**
 * The docs site's pages as static HTML (#558), after `vite build`: each route requested from the built
 * server handler (`dist/server/server.js`, the start mode's `handleRequest`) and written into
 * `dist/client`, as the server would send it, hydration and Appear animations included. Then Pagefind
 * indexes them, for the site's search. It runs on Node (24 runs TypeScript as it is): Bun resolves the
 * server bundle's `solid-js` to its type declarations.
 *
 * - The routes are the MDX pages under `src/content`: `index.mdx` is `/`, `start/solid-2.mdx` is
 *   `/start/solid-2`.
 * - Each is written as `<route>.html`, which Cloudflare Pages serves at `/<route>` with no trailing
 *   slash; `/` as `index.html`; a missing page's render as `404.html`, which Pages sends for any path
 *   it doesn't have.
 * - A route the handler doesn't answer 200 for, or answers with its error page, fails the build.
 * - `sitemap.xml` lists every page; each page's Markdown, `llms.txt` and `llms-full.txt` are
 *   scripts/llms.ts's.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { writeLlms } from "./llms.ts"

const SITE = join(import.meta.dirname, "..")
const CONTENT = join(SITE, "src", "content")
const CLIENT = join(SITE, "dist", "client")
const ORIGIN = "https://wardic.dev"

/** Every file under `dir`, recursively. */
const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return [path]
  })

/** A page's route, from its file: `index.mdx` is `/`, `guides/index.mdx` is `/guides`. */
const routeOf = (file: string): string => {
  const path = relative(CONTENT, file).replace(/\.mdx$/, "").replace(/(^|\/)index$/, "")
  return `/${path}`
}

/** Where a route's HTML goes. */
const fileOf = (route: string): string => {
  if (route === "/") return join(CLIENT, "index.html")
  return join(CLIENT, `${route.slice(1)}.html`)
}

const { handleRequest } = (await import(join(SITE, "dist", "server", "server.js"))) as { handleRequest: (request: Request) => Promise<Response> }

const render = async (route: string, expect: number): Promise<string> => {
  const response = await handleRequest(new Request(ORIGIN + route))
  const html = await response.text()
  if (response.status !== expect || html.includes("Internal Server Error")) throw new Error(`prerender: ${route} answered ${response.status}`)
  return html
}

const routes = filesUnder(CONTENT)
  .filter((file) => file.endsWith(".mdx"))
  .map(routeOf)
  .sort()
for (const route of routes) {
  const file = fileOf(route)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, await render(route, 200))
}
writeFileSync(join(CLIENT, "404.html"), await render("/__no-such-page", 200))
console.log(`prerender: ${routes.length} pages and 404.html into dist/client`)

// The sitemap, every page by its canonical URL, which public/robots.txt names.
const urls = routes.map((route) => `  <url><loc>${ORIGIN}${route}</loc></url>`).join("\n")
writeFileSync(join(CLIENT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)

// Each page as Markdown, llms.txt and llms-full.txt (scripts/llms.ts).
await writeLlms(SITE, CLIENT, ORIGIN)

// The search index, over each page's article (`data-pagefind-body`): not the header, the sidebar or the footer.
execFileSync(join(SITE, "node_modules", ".bin", "pagefind"), ["--site", CLIENT], { stdio: ["ignore", "inherit", "inherit"] })
