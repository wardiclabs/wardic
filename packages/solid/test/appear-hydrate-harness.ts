// Solid 2's Appear hydration harness (#209, ADR-0044; shared since #706): server-render a fixture, put it
// on the page with its head, hydrate it after a while (or never), and record what each `data-k` element
// draws in every frame, with its CSS animation's start. The frames' record and their check against the
// machine are `../appear-frames.ts`, shared with Solid 1's harness and the Foldkit binding's (#794). Not a
// test file itself.
import { hydrate, type JSX } from "@solidjs/web"
import { commands } from "vitest/browser"
import { expect } from "vitest"
import { noteStarts, type Recorded, recordFrames } from "./appear-frames.ts"
import "./browser-commands.ts"

export { type Drawn, drawnOf, followsMachine, machineAt, type Recorded, sinceHydration, TOL, tween } from "./appear-frames.ts"

export interface Run {
  readonly frames: ReadonlyArray<Recorded>
  /** Each watched element's CSS animation's start, on the rAF timeline. */
  readonly startOf: Readonly<Record<string, number>>
  readonly host: HTMLElement
  /** Each watched element's inline `transform` right after `hydrate()` returned, before the first commit. */
  readonly hydratedStyle: Readonly<Record<string, string>>
  /**
   * The time of the frame `hydrate()` was called in, `document.timeline.currentTime`: the start an animation that
   * hydration starts takes, frame-aligned, so it can be up to a frame before the call itself (#854).
   */
  readonly hydratedAt?: number | undefined
  /** Whether hydration claimed each watched element: the server's node is still the one on the page. */
  readonly claimed: Readonly<Record<string, boolean>>
  /** When each late write landed, on the rAF timeline (a streamed run's). */
  readonly landedAt?: ReadonlyArray<number>
}

/** What a run leaves on the page, taken down after each test (each test file's `afterEach` calls them). */
export const cleanups: Array<() => void> = []

let runs = 0

/**
 * Reset Solid 2's hydration state (`@solidjs/web`'s `_$HY.done`), so the next `hydrate()` claims nodes
 * afresh over the server's markup. Each run hydrates as a page's first would.
 */
export const freshHydration = (): void => {
  ;(globalThis as { _$HY?: { done?: boolean } })._$HY!.done = false
}

/** Server-render `file`'s `name`, put it on the page with its head, hydrate after `hydrateAfter` ms (never, without), and record `forMs` of frames. */
export const runServerRendered = async (
  file: string,
  name: string,
  code: () => JSX.Element,
  options: {
    readonly hydrateAfter?: number
    readonly forMs: number
    readonly then?: { readonly afterMs: number; readonly act: () => void }
    /** Whether the server plays an Appear animation, its style in the head: yes, unless `false` (#724). */
    readonly played?: boolean
    /** Whether the markup goes inside an open shadow root, which holds the head's styles too (#724). */
    readonly shadow?: boolean
  },
): Promise<Run> => {
  const renderId = `${name}-${runs++}`
  const { html, head, script, error } = await commands.serverRender2(file, name, renderId)
  if (error !== "") throw new Error(`server render of ${name} failed: ${error}`)
  if (options.played !== false) expect(head, "the head carries the Appear style").toContain("data-wardic-appear")
  if ((globalThis as { _$HY?: unknown })._$HY === undefined) {
    const tag = document.createElement("script")
    tag.textContent = /<script[^>]*>([\s\S]*?)<\/script>/.exec(script)?.[1] ?? ""
    document.head.append(tag)
  }
  const holder = document.createElement("div")
  holder.innerHTML = head
  const styles = [...holder.children]
  document.head.append(...styles)
  const host = document.createElement("div")
  host.innerHTML = html
  // In a shadow root (#724), its tree holds the head's rules too: an animation's name is looked up in the
  // element's own tree, while a slot's custom property is inherited from the document's `:root`.
  let page: Document | ShadowRoot = document
  let placed: Element = host
  if (options.shadow === true) {
    placed = document.createElement("div")
    const shadow = placed.attachShadow({ mode: "open" })
    shadow.append(...styles.map((style) => style.cloneNode(true)), host)
    page = shadow
  }
  document.body.append(placed)
  const watched = [...host.querySelectorAll("[data-k]")]
  let hydrated = false
  let dispose = (): void => {}
  cleanups.push(() => {
    dispose()
    placed.remove()
    for (const style of styles) style.remove()
  })
  const startOf: Record<string, number> = {}
  const hydratedStyle: Record<string, string> = {}
  let hydratedAt: number | undefined
  if (options.then !== undefined) {
    const { afterMs, act } = options.then
    const timer = setTimeout(act, afterMs)
    cleanups.push(() => clearTimeout(timer))
  }
  const claimed: Record<string, boolean> = {}
  if (options.hydrateAfter !== undefined) {
    setTimeout(() => {
      freshHydration()
      // Each watched element's CSS animation's start, noted just before the Handoff takes them over (#524).
      noteStarts(page, watched, startOf)
      hydratedAt = document.timeline.currentTime as number
      dispose = hydrate(code, host, { renderId })
      hydrated = true
      for (const el of watched) {
        const k = (el as HTMLElement).dataset.k!
        hydratedStyle[k] = (el as HTMLElement).style.transform
        claimed[k] = host.querySelector(`[data-k="${k}"]`) === el
      }
    }, options.hydrateAfter)
  }
  const frames = await recordFrames({ page, watched: () => watched, forMs: options.forMs, hydrated: () => hydrated, startOf })
  return { frames, startOf, host, hydratedStyle, claimed, hydratedAt }
}
