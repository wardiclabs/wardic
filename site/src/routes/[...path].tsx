/**
 * Every page (#558): its MDX file under `src/content/`, by the path asked for, its front matter's
 * `title` in the document's head. Each page is a chunk of its own, loaded as it's opened (prerendered,
 * and preloaded before the page hydrates), so a page ships its own content and not every other's.
 * Each page enters as you open it.
 */
import { useParams } from "@solidjs/router"
import { dynamic, useHead } from "@solidjs/web"
import { w } from "@wardic/solid/unstable/v2"
import type { Component } from "solid-js"
import { createMemo, For, lazy, Show } from "solid-js"
import TITLES from "virtual:page-titles"

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

export default function Page() {
  const params = useParams()
  const page = createMemo(() => pageOf(params.path))
  useHead(() => {
    const found = page()
    if (found === undefined) return { tag: "title", props: { children: "Not found · Wardic" }, key: "title" }
    const title = TITLES[found.name] ?? "Wardic"
    return { tag: "title", props: { children: title === "Wardic" ? title : `${title} · Wardic` }, key: "title" }
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
                <Current />
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
