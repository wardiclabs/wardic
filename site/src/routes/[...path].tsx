/**
 * Every page (#558): its MDX file under `src/content/`, by the path asked for, its front matter's
 * `title` and `description` in the document's head, with what a link's preview and a search engine
 * read: its canonical URL, Open Graph's title, description and URL, and, on the home page, the
 * project as JSON-LD. A missing page asks not to be indexed. Each page is a chunk of its own, loaded as it's opened (prerendered,
 * and preloaded before the page hydrates), so a page ships its own content and not every other's.
 * Each page enters as you open it. A page that fails to render says so in its place, and the frame
 * around it, the sidebar included, stays.
 */
import { useParams } from "@solidjs/router"
import type { HeadTag } from "@solidjs/web"
import { dynamic, useHead } from "@solidjs/web"
import { w } from "~/lib/wardic.ts"
import type { Component } from "solid-js"
import { createMemo, Errored, For, lazy, Show } from "solid-js"
import DESCRIPTIONS from "virtual:page-descriptions"
import TITLES from "virtual:page-titles"
import { Failed } from "~/components/Failed.tsx"

/**
 * Each page, by its glob key, as a `lazy` component. Its `moduleUrl` is the file's path from the
 * site's root, the client manifest's key for its chunk, which the server names in the page so the
 * client loads it before hydrating, as the router does for a route's.
 */
const PAGES: Readonly<Record<string, Component>> = Object.fromEntries(
  Object.entries(import.meta.glob<{ readonly default: Component }>("../content/**/*.mdx")).map(([key, load]) => [key, lazy(load, undefined, key.replace(/^\.\.\//, "src/"))]),
)

/** A page, by its path: `/` is `index.mdx`, `/guides/layout` is `guides/layout.mdx`. Its name is its key in `TITLES`. */
const pageOf = (path: string | undefined): { readonly name: string; readonly page: Component } | undefined => {
  let name = "index"
  if (path !== undefined && path !== "") name = path.replace(/\/$/, "")
  const file = PAGES[`../content/${name}.mdx`]
  if (file !== undefined) return { name, page: file }
  const index = PAGES[`../content/${name}/index.mdx`]
  if (index !== undefined) return { name: `${name}/index`, page: index }
  return undefined
}

/** Where the site is served: a page's canonical URL is its path here. */
const ORIGIN = "https://wardic.dev"

/** A page's path, from its name: `index` is `/`, `guides/index` is `/guides`. */
const pathOf = (name: string): string => `/${name.replace(/(^|\/)index$/, "")}`

/** What a search engine reads of the project, on the home page: the site and the code it documents. */
const STRUCTURED = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Wardic", url: `${ORIGIN}/` },
    {
      "@type": "SoftwareSourceCode",
      name: "Wardic",
      description: DESCRIPTIONS["index"],
      url: `${ORIGIN}/`,
      codeRepository: "https://github.com/wardiclabs/wardic",
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
    },
  ],
})

/** A page's head: its title and description, its canonical URL, and Open Graph's. */
const headOf = (name: string): ReadonlyArray<HeadTag> => {
  const title = TITLES[name] ?? "Wardic"
  const full = title === "Wardic" ? title : `${title} · Wardic`
  const description = DESCRIPTIONS[name] ?? DESCRIPTIONS["index"]
  const url = ORIGIN + pathOf(name)
  const tags: Array<HeadTag> = [
    { tag: "title", props: { children: full }, key: "title" },
    { tag: "meta", props: { name: "description", content: description }, key: "description" },
    { tag: "link", props: { rel: "canonical", href: url }, key: "canonical" },
    { tag: "meta", props: { property: "og:title", content: full }, key: "og:title" },
    { tag: "meta", props: { property: "og:description", content: description }, key: "og:description" },
    { tag: "meta", props: { property: "og:url", content: url }, key: "og:url" },
    { tag: "meta", props: { property: "og:type", content: name === "index" ? "website" : "article" }, key: "og:type" },
  ]
  if (name === "index") tags.push({ tag: "script", props: { type: "application/ld+json", children: STRUCTURED }, key: "structured" })
  return tags
}

/** A missing page's head: its title, and no indexing. */
const NOT_FOUND: ReadonlyArray<HeadTag> = [
  { tag: "title", props: { children: "Not found · Wardic" }, key: "title" },
  { tag: "meta", props: { name: "robots", content: "noindex" }, key: "robots" },
]

export default function Page() {
  const params = useParams()
  const page = createMemo(() => pageOf(params.path))
  useHead(() => {
    const found = page()
    if (found === undefined) return [...NOT_FOUND]
    return [...headOf(found.name)]
  })
  return (
    <Show when={page()} fallback={<NotFound />}>
      {(found) => (
        <For each={[found().page]}>
          {(current) => {
            // Not static: its memo holds the page's chunk while it loads, as `<Dynamic>`'s did (#618, S2).
            const Current = dynamic(() => current)
            return (
              <w.article class="prose" data-pagefind-body initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
                {/* #618 (S3): with no boundary, a page's error took the whole site down with it. */}
                <Errored fallback={(error, reset) => <Failed what="This page" error={error()} retry={reset} />}>
                  <Current />
                </Errored>
              </w.article>
            )
          }}
        </For>
      )}
    </Show>
  )
}

function NotFound() {
  return (
    <article class="prose">
      <h1>Nothing here</h1>
      <p>
        That page doesn't exist. <a href="/">Back to the start</a>.
      </p>
    </article>
  )
}
