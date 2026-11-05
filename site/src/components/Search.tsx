/**
 * The site's search (#558): Pagefind's index of every page's article, built after the prerender. The
 * dialog is Kobalte's (focus in, Tab kept inside, Escape, focus back), drawn by Wardic: the shade
 * fades, the panel rises, and both leave as smoothly. ⌘K or Ctrl+K opens it. Pagefind's script loads
 * the first time it opens; the dev server has no index, so there it says where search works.
 */
import { Dialog } from "@kobalte/core/dialog"
import { AnimatePresence, w } from "@wardic/solid/unstable/v2"
import { createSignal, For, onFlush, onSettled, Show } from "solid-js"

const Shade = w.create(Dialog.Overlay)
const Panel = w.create(Dialog.Content)

const shade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { type: "tween", duration: 0.15 } } as const
const rise = {
  initial: { opacity: 0, y: -12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.98, transition: { type: "tween", duration: 0.12 } },
  transition: { type: "spring", stiffness: 420, damping: 34 },
} as const

interface Hit {
  readonly url: string
  readonly title: string
  readonly excerpt: string
}

interface Pagefind {
  readonly debouncedSearch: (query: string) => Promise<{ readonly results: ReadonlyArray<{ readonly data: () => Promise<{ readonly url: string; readonly excerpt: string; readonly meta: { readonly title?: string } }> }> } | null>
}

/** Pagefind's script, served beside the pages. A variable, so the bundler leaves it for the browser. */
const PAGEFIND = "/pagefind/pagefind.js"

/** A page's address without the `.html` Pagefind keeps from its file. */
const pathOf = (url: string): string => url.replace(/\.html$/, "")

export function Search() {
  const [open, setOpen] = createSignal(false)
  const [hits, setHits] = createSignal<ReadonlyArray<Hit>>([])
  const [unavailable, setUnavailable] = createSignal(false)
  let pagefind: Promise<Pagefind | undefined> | undefined

  const load = (): Promise<Pagefind | undefined> => {
    if (pagefind === undefined) pagefind = import(/* @vite-ignore */ PAGEFIND).then((module: Pagefind) => module).catch(() => undefined)
    return pagefind
  }

  const search = async (query: string): Promise<void> => {
    const found = await load()
    if (found === undefined) {
      setUnavailable(true)
      return
    }
    if (query.trim() === "") {
      setHits([])
      return
    }
    const response = await found.debouncedSearch(query)
    if (response === null) return
    const data = await Promise.all(response.results.slice(0, 8).map((result) => result.data()))
    setHits(data.map((hit) => ({ url: pathOf(hit.url), title: hit.meta.title ?? pathOf(hit.url), excerpt: hit.excerpt })))
  }

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <Dialog open={open()} onOpenChange={setOpen} forceMount>
      <Dialog.Trigger class="search-button" aria-label="Search the docs">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <span>Search</span>
        <kbd>⌘K</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <AnimatePresence>
          <Show when={open()}>
            <Shade class="search-shade" {...shade} />
            <Panel class="search-panel" {...rise}>
              <Dialog.Title class="visually-hidden">Search the docs</Dialog.Title>
              <input class="search-input" type="search" placeholder="Search the docs" aria-label="Search the docs" autofocus onInput={(event) => void search(event.currentTarget.value)} />
              <Show when={!unavailable()} fallback={<p class="search-note">Search works in the built site, once Pagefind has indexed it (`bun run build` in site/).</p>}>
                <ul class="search-hits">
                  <For each={hits()}>
                    {(hit) => (
                      <li>
                        {/* Closed after the click's flush, not held with the navigation (#618), as the drawer is. */}
                        <a href={hit.url} onClick={() => onFlush(() => setOpen(false))}>
                          <strong>{hit.title}</strong>
                          <span innerHTML={hit.excerpt} />
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Panel>
          </Show>
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog>
  )
}
