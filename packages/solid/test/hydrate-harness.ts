// The hydration project's harness (ADR-0021, decision 10): render a fixture on the server
// (the `serverRender` command), put its markup on the page, hydrate it, and record what a
// user would see. Solid 1.9.13 claims a server node by its hydration key whatever its tag,
// and patches a different style silently, so the tests compare markup and nodes directly.
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import { sharedConfig, type JSX } from "solid-js"
import { hydrate, render } from "solid-js/web"
import { commands } from "vitest/browser"
import "./browser-commands.ts"

/** The fixtures module, relative to packages/solid (the server loads it by this path). */
export const FIXTURES_FILE = "./test/hydrate-fixtures.tsx"

/** Run Solid's hydration bootstrap (`window._$HY`) once per page. */
const injectHydrationScript = (script: string): void => {
  if ((globalThis as { _$HY?: unknown })._$HY !== undefined) return
  const body = /<script[^>]*>([\s\S]*?)<\/script>/.exec(script)?.[1]
  if (body === undefined) throw new Error("serverRender returned no hydration script")
  const tag = document.createElement("script")
  tag.textContent = body
  document.head.append(tag)
}

/** Collect `console.error` until the returned function is called (it returns what it saw). */
export const captureConsoleErrors = (): (() => ReadonlyArray<string>) => {
  const seen: Array<string> = []
  const original = console.error
  console.error = (...args: Array<unknown>) => {
    seen.push(args.map(String).join(" "))
    original(...args)
  }
  return () => {
    console.error = original
    return seen
  }
}

/** A fixture rendered on the server and hydrated in this page. */
export interface Hydrated {
  readonly host: HTMLElement
  /** The server's markup, as rendered. */
  readonly html: string
  /** Every element under `host` before hydration, in document order. */
  readonly before: ReadonlyArray<Element>
  /** Each of those elements' attributes as the server rendered them (read before hydration). */
  readonly serverAttributes: ReadonlyMap<Element, Readonly<Record<string, string>>>
  /** What `hydrate` threw, `""` if nothing. */
  readonly threw: string
  /** Stop capturing `console.error`; returns everything it saw since hydration started. */
  readonly stopErrors: () => ReadonlyArray<string>
  readonly dispose: () => void
}

/**
 * Server-render fixture `name` (under `renderId = name`) from `file`, put its markup on the page and
 * hydrate it with `code`, after `waiting` has run with the page's host. A server error rejects with its
 * first line.
 */
export const hydrateFixture = async (name: string, code: () => JSX.Element, file: string = FIXTURES_FILE, waiting?: (host: HTMLElement) => Promise<void>): Promise<Hydrated> => {
  const { html, script, error } = await commands.serverRender(file, name, name)
  if (error !== "") throw new Error(`server render of ${name} failed: ${error}`)
  injectHydrationScript(script)
  const host = document.createElement("div")
  host.dataset.fixture = name
  host.innerHTML = html
  document.body.append(host)
  const before = [...host.querySelectorAll("*")]
  const serverAttributes = new Map(before.map((el) => [el, Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]))]))
  if (waiting !== undefined) await waiting(host)
  // A delegated event or a mismatch marks hydration done, after which `hydrate` only renders.
  ;(globalThis as { _$HY?: { done?: boolean } })._$HY!.done = false
  sharedConfig.done = false
  const stopErrors = captureConsoleErrors()
  let threw = ""
  let dispose = (): void => {}
  try {
    dispose = hydrate(code, host, { renderId: name })
  } catch (e) {
    threw = String(e).split("\n")[0] ?? String(e)
  }
  return {
    host,
    html,
    before,
    serverAttributes,
    threw,
    stopErrors,
    dispose: () => {
      dispose()
      host.remove()
    },
  }
}

/** Render `code` client-only (no server markup, no hydration) into a new host. */
export const renderClientOnly = (code: () => JSX.Element): { readonly host: HTMLElement; readonly dispose: () => void } => {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(code, host)
  return {
    host,
    dispose: () => {
      dispose()
      host.remove()
    },
  }
}

/**
 * `root`'s structure: each element's tag, its attributes (without `style` and `data-hk`)
 * sorted, and its trimmed text, depth first. Styles are compared on their own (HY3, HY4).
 */
export const structureOf = (root: Element): string => {
  const out: Array<string> = []
  const walk = (node: Node, depth: number): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? ""
      if (text !== "") out.push(`${"  ".repeat(depth)}"${text}"`)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const attrs = [...el.attributes]
      .filter((a) => a.name !== "style" && a.name !== "data-hk")
      .map((a) => `${a.name}="${a.value}"`)
      .sort()
    out.push(`${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${Bool.match(attrs.length > 0, { onTrue: () => ` ${attrs.join(" ")}`, onFalse: () => "" })}>`)
    for (const child of el.childNodes) walk(child, depth + 1)
  }
  for (const child of root.childNodes) walk(child, 0)
  return out.join("\n")
}

/** An element's inline style attribute (or a `style` string), parsed into `{ property: value }`. */
export const styleOf = (el: Element | string | null | undefined): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (Match.value(el).pipe(Match.when(Match.string, (style) => style), Match.orElse((node) => node?.getAttribute("style"))) ?? "")
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d !== "")
      .map((d) => {
        const i = d.indexOf(":")
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()]
      }),
  )

/** Resolves with `read()` taken just before the next paint (a ResizeObserver runs after layout, before paint). */
export const atNextPaint = <A>(read: () => A): Promise<A> =>
  new Promise((resolve) => {
    const probe = document.createElement("i")
    document.body.append(probe)
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      const value = read()
      probe.remove()
      resolve(value)
    })
    observer.observe(probe)
  })

/** Poll `read` each Refresh frame until it's within `tolerance` of `target`, or `timeoutMs` passes; returns the last value. */
export const settle = async (read: () => number, target: number, tolerance: number, timeoutMs = 2000): Promise<number> => {
  const start = performance.now()
  let value = read()
  while (Math.abs(value - target) > tolerance && performance.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    value = read()
  }
  return value
}
