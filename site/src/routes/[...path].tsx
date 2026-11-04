/**
 * Every page (#558): its MDX file under `src/content/`, by the path asked for, its front matter's
 * `title` in the document's head. Each page enters as you open it.
 */
import { useParams } from "@solidjs/router"
import { Dynamic, useHead } from "@solidjs/web"
import { w } from "@wardic/solid/unstable/v2"
import type { Component } from "solid-js"
import { createMemo, For, Show } from "solid-js"

interface Page {
  readonly default: Component
  readonly frontmatter?: { readonly title?: string; readonly description?: string } | undefined
}

const PAGES = import.meta.glob<Page>("../content/**/*.mdx", { eager: true })

/** A page's module, by its path: `/` is `index.mdx`, `/guides/layout` is `guides/layout.mdx`. */
const pageOf = (path: string | undefined): Page | undefined => {
  let name = "index"
  if (path !== undefined && path !== "") name = path.replace(/\/$/, "")
  return PAGES[`../content/${name}.mdx`] ?? PAGES[`../content/${name}/index.mdx`]
}

export default function Page() {
  const params = useParams()
  const page = createMemo(() => pageOf(params.path))
  useHead(() => {
    const title = page()?.frontmatter?.title
    if (title === undefined) return { tag: "title", props: { children: "Not found · Wardic" }, key: "title" }
    return { tag: "title", props: { children: title === "Wardic" ? title : `${title} · Wardic` }, key: "title" }
  })
  return (
    <Show when={page()} fallback={<NotFound />}>
      {(found) => (
        <For each={[found()]}>
          {(current) => (
            <w.article class="prose" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
              <Dynamic component={current.default} />
            </w.article>
          )}
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
