/**
 * The site's frame (#558): the header, the sidebar of sections and pages, the page, and the footer.
 * The sidebar's marker sits under the page you're on, a `layoutId` that slides to the next one you
 * open. On a narrow screen the sidebar is hidden, and the menu button opens it.
 */
import { useLocation } from "@solidjs/router"
import { w } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, For, Show } from "solid-js"
import { Search } from "~/components/Search.tsx"
import { ThemeToggle } from "~/components/ThemeToggle.tsx"
import { NAV, type NavPage } from "~/nav.ts"

const GITHUB = "https://github.com/wardiclabs/wardic"

/** A path without its trailing slash, `/` kept. */
const pathOf = (path: string): string => path.replace(/(.)\/$/, "$1")

function Sidebar(props: { readonly onNavigate?: () => void }) {
  const location = useLocation()
  const here = () => pathOf(location.pathname)
  /** A list of pages, the one you're on carrying the marker. */
  const Pages = (list: { readonly pages: ReadonlyArray<NavPage> }) => (
    <ul>
      <For each={list.pages}>
        {(page) => {
          const current = () => here() === page.path
          return (
            <li>
              <a href={page.path} aria-current={current() ? "page" : undefined} onClick={() => props.onNavigate?.()}>
                <Show when={current()}>
                  <w.span class="nav-marker" layoutId="nav-marker" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                </Show>
                <span>{page.title}</span>
              </a>
            </li>
          )
        }}
      </For>
    </ul>
  )
  return (
    <nav class="sidebar" aria-label="Pages">
      <For each={NAV}>
        {(section) => (
          <section>
            <h2>{section.title}</h2>
            <Pages pages={section.pages} />
            {/* The reference's families: each open while you're on one of its pages, and to a click. */}
            <For each={section.groups ?? []}>
              {(group) => (
                <details class="nav-group" open={group.pages.some((page) => page.path === here())}>
                  <summary>{group.title}</summary>
                  <Pages pages={group.pages} />
                </details>
              )}
            </For>
          </section>
        )}
      </For>
    </nav>
  )
}

export function Layout(props: { readonly children?: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="site">
      <header class="site-header">
        <button class="icon-button menu-button" type="button" aria-label="Pages" aria-expanded={String(open()) as "true" | "false"} onClick={() => setOpen(!open())}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <a class="wordmark" href="/">
          <span class="wordmark-dot" aria-hidden="true" />
          Wardic
        </a>
        <div class="header-tools">
          <Search />
          <ThemeToggle />
          <w.a class="icon-button" href={GITHUB} aria-label="Wardic on GitHub" title="Wardic on GitHub" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
              <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
            </svg>
          </w.a>
        </div>
      </header>
      <div class="site-body" data-menu={open() ? "open" : "closed"}>
        <Sidebar onNavigate={() => setOpen(false)} />
        <main class="site-main">{props.children}</main>
      </div>
      <footer class="site-footer">
        <p>
          MIT licensed. Parts are ported from <a href="https://motion.dev">Motion</a>, MIT licensed too. <a href={GITHUB}>Source on GitHub</a>.
        </p>
      </footer>
    </div>
  )
}
