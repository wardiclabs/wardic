/**
 * The site's frame (#558): the header, the sidebar of sections and pages, the page, and the footer.
 * The sidebar's marker sits under the page you're on, a `layoutId` that slides to the next one you
 * open. On a narrow screen the sidebar is hidden, and the menu button opens the drawer: the same
 * pages, which slide in and out under `AnimatePresence`.
 */
import { useLocation } from "@solidjs/router"
import { AnimatePresence, w } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, For, Show } from "solid-js"
import { Logo } from "~/components/Logo.tsx"
import { Search } from "~/components/Search.tsx"
import { ThemeToggle } from "~/components/ThemeToggle.tsx"
import { NAV, type NavPage } from "~/nav.ts"

const GITHUB = "https://github.com/wardiclabs/wardic"

/** A path without its trailing slash, `/` kept. */
const pathOf = (path: string): string => path.replace(/(.)\/$/, "$1")

/**
 * The sections, their pages and their families, with the marker under the page you're on. The sidebar
 * and the drawer each have them, under their own `layoutId`: the drawer's marker never animates from
 * the hidden sidebar's, whose box, under `display: none`, is nothing at the page's corner.
 */
function Sections(props: { readonly marker: string; readonly onNavigate?: () => void }) {
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
                  <w.span class="nav-marker" layoutId={props.marker} transition={{ type: "spring", stiffness: 500, damping: 40 }} />
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
  )
}

/**
 * The drawer slides in from off the screen's left edge, and back out, quicker, the way it came. It's
 * the screen's width, so it starts that far left, in px: a percentage `initial` isn't applied to an
 * element as it mounts (the exit's `-100%` is), and the drawer only mounts in the browser, on a tap.
 */
const drawerOff = () => ({ x: -window.innerWidth })
const DRAWER_IN = { x: 0, transition: { type: "spring", stiffness: 380, damping: 40 } } as const
const DRAWER_OUT = { x: "-100%", transition: { type: "tween", duration: 0.22, ease: "easeIn" } } as const

export function Layout(props: { readonly children?: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="site">
      <header class="site-header">
        <button class="icon-button menu-button" type="button" aria-label="Pages" aria-controls="drawer" aria-expanded={String(open()) as "true" | "false"} onClick={() => setOpen(!open())}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {/* The logo draws itself as the page first paints, and again on hover (Logo.tsx). */}
        <w.a class="wordmark" href="/" aria-label="Wardic" initial="hidden" animate="shown" whileHover="hover">
          <Logo />
        </w.a>
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
      {/*
        The drawer, on a narrow screen: it slides in as it opens and out as it closes, a page you open
        in it closing it. A layout root: its slide is a transform, and a page that lands as it slides
        out moves its marker only inside it. Its scroll needs nothing (the Layout guide).
      */}
      <AnimatePresence>
        <Show when={open()}>
          <w.nav id="drawer" class="sidebar drawer" aria-label="Pages" layoutRoot initial={drawerOff()} animate={DRAWER_IN} exit={DRAWER_OUT}>
            <Sections marker="drawer-marker" onNavigate={() => setOpen(false)} />
          </w.nav>
        </Show>
      </AnimatePresence>
      <div class="site-body">
        <nav class="sidebar" aria-label="Pages">
          <Sections marker="nav-marker" />
        </nav>
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
