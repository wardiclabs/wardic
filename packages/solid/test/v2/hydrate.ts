// The Solid 2 binding's hydration harness (#209 PR 4a, ADR-0021 decision 10): render a fixture on
// the server (`serverRender2`, `serverStream2`), put its head tags and markup on the page, hydrate it
// with `@solidjs/web`'s `hydrate`, and dispose it after the test. As `../hydrate-harness.ts` does for
// Solid 1.
import { hydrate, type JSX } from "@solidjs/web"
import { afterEach } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"

/** The fixtures module, relative to packages/solid (the server loads it by this path). */
export const FIXTURES_FILE = "./test/v2/hydrate-fixtures.tsx"

/** Run Solid's hydration bootstrap (`window._$HY`) once per page. */
const injectHydrationScript = (script: string): void => {
  if ((globalThis as { _$HY?: unknown })._$HY !== undefined) return
  const body = /<script[^>]*>([\s\S]*?)<\/script>/.exec(script)?.[1]
  if (body === undefined) throw new Error("serverRender2 returned no hydration script")
  const tag = document.createElement("script")
  tag.textContent = body
  document.head.append(tag)
}

/** Parse `html` and append its nodes to `parent`, returning them. */
const appendHtml = (parent: Node, html: string): ReadonlyArray<Node> => {
  const template = document.createElement("template")
  template.innerHTML = html
  const nodes = [...template.content.childNodes]
  for (const node of nodes) parent.appendChild(node)
  return nodes
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** A fixture rendered on the server and hydrated in this page. */
export interface Hydrated2 {
  readonly host: HTMLElement
  /** The server's markup, as rendered. */
  readonly html: string
  /** The server's head tags, as rendered. */
  readonly head: string
  /** The head nodes the server's tags became on the page. */
  readonly headNodes: ReadonlyArray<Node>
  /** Whether hydration claimed the server's `[data-k]` element `k`: it's still the one on the page. */
  readonly claimed: (k: string) => boolean
  readonly dispose: () => void
}

/** Where a fixture comes from, and what runs before its hydration. */
export interface HydrateOptions2 {
  /** The fixtures module, `FIXTURES_FILE` by default. */
  readonly file?: string
  /** Run with the page's host once the server's markup is on it, before hydration: a page's JS comes later. */
  readonly waiting?: (host: HTMLElement) => Promise<void>
}

/** Server-render fixture `name` (under `renderId = name`), put it on the page, and hydrate it with `code`. */
export const hydrateFixture2 = async (name: string, code: () => JSX.Element, options: HydrateOptions2 = {}): Promise<Hydrated2> => {
  const { html, head, script, error } = await commands.serverRender2(options.file ?? FIXTURES_FILE, name, name)
  if (error !== "") throw new Error(`server render of ${name} failed: ${error}`)
  const headNodes = appendHtml(document.head, head)
  const host = document.createElement("div")
  host.innerHTML = html
  document.body.append(host)
  const server = new Map([...host.querySelectorAll<HTMLElement>("[data-k]")].map((el) => [el.dataset.k!, el]))
  injectHydrationScript(script)
  if (options.waiting !== undefined) await options.waiting(host)
  // Every test shares one page: a hydration marks it done (`_$HY.done`), and `hydrate` then renders
  // afresh over the server's markup. Each hydrates as a page's first would.
  ;(globalThis as { _$HY?: { done?: boolean } })._$HY!.done = false
  const dispose = hydrate(code, host, { renderId: name })
  let done = false
  const cleanup = (): void => {
    if (done) return
    done = true
    dispose()
    host.remove()
    for (const node of headNodes) if (node.parentNode !== null) node.parentNode.removeChild(node)
  }
  cleanups.push(cleanup)
  const claimed = (k: string): boolean => server.has(k) && host.querySelector(`[data-k="${k}"]`) === server.get(k)
  return { host, html, head, headNodes, claimed, dispose: cleanup }
}

/** Run each `<script>` under `root` as the parser would: an `innerHTML` one doesn't. */
const runScripts = (root: ParentNode): void => {
  for (const old of [...root.querySelectorAll("script")]) {
    const script = document.createElement("script")
    script.textContent = old.textContent
    old.replaceWith(script)
  }
}

/** A landed write's node: a `<script>` run as a parser would, or the scripts inside it. */
const runLanded = (node: Node): void => {
  if (node instanceof HTMLScriptElement) {
    const script = document.createElement("script")
    script.textContent = node.textContent
    node.replaceWith(script)
    return
  }
  if (node instanceof Element) runScripts(node)
}

/**
 * Stream fixture `name` (`renderToStream`, #343) and hydrate it with `code` once every write has
 * landed: the shell in a host, each later write after it, their scripts run as a parser would. What a
 * server serialized for the page (an async memo's value) is on `_$HY` when hydration starts.
 */
export const hydrateStreamed2 = async (name: string, code: () => JSX.Element): Promise<Hydrated2> => {
  const { writes, head, script, error } = await commands.serverStream2(FIXTURES_FILE, name, name)
  if (error !== "") throw new Error(`stream of ${name} failed: ${error}`)
  const headNodes = appendHtml(document.head, head)
  injectHydrationScript(script)
  // A page before its JS has no client fragment handler (`_$HY.f`), so a chunk's `$df` places it
  // itself; an earlier test's hydration installed one on this shared page, put back to hydrate.
  const hy = (globalThis as { _$HY?: Record<string, unknown> })._$HY!
  const clientFragments = hy.f
  delete hy.f
  const [shell = "", ...later] = writes
  const host = document.createElement("div")
  host.innerHTML = shell
  document.body.append(host)
  runScripts(host)
  const landed: Array<Node> = []
  for (const write of later) {
    const nodes = appendHtml(document.body, write)
    landed.push(...nodes)
    for (const node of nodes) runLanded(node)
  }
  const server = new Map([...host.querySelectorAll<HTMLElement>("[data-k]")].map((el) => [el.dataset.k!, el]))
  if (clientFragments !== undefined && hy.f === undefined) hy.f = clientFragments
  hy.done = false
  const dispose = hydrate(code, host, { renderId: name })
  let done = false
  const cleanup = (): void => {
    if (done) return
    done = true
    dispose()
    host.remove()
    for (const node of [...headNodes, ...landed]) if (node.parentNode !== null) node.parentNode.removeChild(node)
  }
  cleanups.push(cleanup)
  const claimed = (k: string): boolean => server.has(k) && host.querySelector(`[data-k="${k}"]`) === server.get(k)
  return { host, html: writes.join(""), head, headNodes, claimed, dispose: cleanup }
}

