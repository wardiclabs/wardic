// The foldkit-hydrate project's harness (#794; ADR-0021, decision 10; ADR-0044): a fixture's program
// rendered on a server (the `serverRenderProgram` command, Foldkit's `renderToString` for this project's
// server environment), its markup put on the page as a server's response leaves it, hydrated through the
// Handle's `wardic.hydrate`, and what each `data-k` element draws recorded every frame on the Appear
// harness both Solid bindings record with (`packages/solid/test/appear-frames.ts`). Under a dev server,
// this one, Foldkit renders the hydration about half a second after `hydrate` is called (its wait for
// `@foldkit/vite-plugin`'s Model preservation, absent here): the middle of a 1.2 s entrance. A production
// page hydrates as soon as its script runs. Not a test file itself.
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as Runtime from "foldkit/runtime"
import { commands } from "vitest/browser"
import { vi } from "vitest"
import { type Recorded, recordFrames } from "../../solid/test/appear-frames.ts"
import "./browser-commands.ts"
import type { Make } from "./hydrate-fixtures.ts"

/** The fixtures module, relative to packages/foldkit (the server loads it by this path). */
export const FIXTURES_FILE = "./test/hydrate-fixtures.ts"

/** The build id both renders carry: a page from another deployment is refused. */
export const BUILD_ID = "foldkit-hydrate"

/** The attribute Foldkit stamps a hydratable root with, stripped as the hydration render adopts it. */
const STAMP = "data-foldkit-app"

/** A fixture rendered on the server and hydrated in this page. */
export interface Run {
  /** The server's markup, as rendered. */
  readonly html: string
  readonly host: HTMLElement
  /** The stamped root the server rendered, hydrated in place. */
  readonly root: HTMLElement
  /** Every element under the root before hydration, in document order. */
  readonly before: ReadonlyArray<Element>
  readonly frames: ReadonlyArray<Recorded>
  /** Each watched element's CSS animation's start, on the rAF timeline. */
  readonly startOf: Readonly<Record<string, number>>
  /** What `console.warn` said from the hydration's start until the run ended: Foldkit's mismatch word among them, if any. */
  readonly warned: ReadonlyArray<string>
  /** Whether the hydration render has run: Foldkit strips the root's stamp as it adopts the page. */
  readonly hydrated: () => boolean
}

/** What a run leaves on the page, taken down after each test (the test file's `afterEach` calls them). */
export const cleanups: Array<() => void> = []

/** Whether `root` is hydrated yet (above). */
const hydratedOf = (root: Element) => (): boolean => Bool.not(root.hasAttribute(STAMP))

/**
 * Server-render `name`'s program (`make` is the same export, for the client: a fresh fixture, its Handle
 * its own), put its markup on the page, hydrate it with its Handle, and record `forMs` of frames; `then`
 * acts after `afterMs`, as a test clicks once the entrance has landed. The program runs on for the page's
 * lifetime, idle once its host is removed: Foldkit's `hydrate` owns the page and gives nothing back.
 */
export const runHydrated = async (name: string, make: Make, options: { readonly forMs: number; readonly then?: { readonly afterMs: number; readonly act: () => void } }): Promise<Run> => {
  const { html, error } = await commands.serverRenderProgram(FIXTURES_FILE, name, BUILD_ID)
  if (Predicate.isTruthy(error)) throw new Error(`server render of ${name} failed: ${error}`)
  const host = document.createElement("div")
  host.innerHTML = html
  document.body.append(host)
  const root = host.querySelector<HTMLElement>(`[${STAMP}]`)
  if (Predicate.isNull(root)) throw new Error(`server render of ${name} carries no stamped root: ${html.slice(0, 200)}`)
  const before = [...root.querySelectorAll("*")]
  const watched = [...host.querySelectorAll("[data-k]")]
  const warned: Array<string> = []
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: Array<unknown>) => {
    warned.push(args.map(String).join(" "))
  })
  cleanups.push(() => {
    warn.mockRestore()
    host.remove()
    for (const style of document.head.querySelectorAll("style[data-wardic-appear]")) style.remove()
  })
  if (Predicate.isNotUndefined(options.then)) {
    const { afterMs, act } = options.then
    const timer = setTimeout(act, afterMs)
    cleanups.push(() => clearTimeout(timer))
  }
  const startOf: Record<string, number> = {}
  const fixture = make()
  // The page's only stamped root is this one (`container: null`, the stamp the handle): the last run's host has left.
  fixture.handle.hydrate(Runtime.makeApplication({ ...fixture.program, container: null }), { buildId: BUILD_ID })
  const hydrated = hydratedOf(root)
  const frames = await recordFrames({ page: document, watched, forMs: options.forMs, hydrated, startOf })
  return { html, host, root, before, frames, startOf, warned, hydrated }
}
