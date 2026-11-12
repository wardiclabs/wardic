// Solid 2's Appear hydration harness (#209, ADR-0044; shared since #706): server-render a fixture, put it
// on the page with its head, hydrate it after a while (or never), and record what each `data-k` element
// draws in every frame, with its CSS animation's start. Not a test file itself.
import * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import { hydrate, type JSX } from "@solidjs/web"
import { commands } from "vitest/browser"
import { expect } from "vitest"
import "../browser-commands.ts"

/** What one element draws in one frame. */
export interface Drawn {
  readonly opacity: number
  readonly x: number
  readonly y: number
  readonly rotate: number
  /** An SVG element's `cx` and `r`, and its stroke dash's first length (#245); 0 where it has none. */
  readonly cx: number
  readonly r: number
  readonly dash: number
  /** Its scale on x (no rotation), and its painted box's width and top (#245). */
  readonly scale: number
  readonly width: number
  readonly top: number
  /** Whether a CSS animation still runs on it. */
  readonly css: boolean
}

/** One frame: its rAF time, what each watched element draws, and whether hydration has run. */
export interface Recorded {
  readonly at: number
  readonly hydrated: boolean
  readonly drawn: Readonly<Record<string, Drawn>>
}

export interface Run {
  readonly frames: ReadonlyArray<Recorded>
  /** Each watched element's CSS animation's start, on the rAF timeline. */
  readonly startOf: Readonly<Record<string, number>>
  readonly host: HTMLElement
  /** Each watched element's inline `transform` right after `hydrate()` returned, before the first commit. */
  readonly hydratedStyle: Readonly<Record<string, string>>
  /** Whether hydration claimed each watched element: the server's node is still the one on the page. */
  readonly claimed: Readonly<Record<string, boolean>>
  /** When each late write landed, on the rAF timeline (a streamed run's). */
  readonly landedAt?: ReadonlyArray<number>
}

/** What a run leaves on the page, taken down after each test (each test file's `afterEach` calls them). */
export const cleanups: Array<() => void> = []

export const drawnOf = (el: Element): Drawn => {
  const computed = getComputedStyle(el)
  // "none" isn't a matrix DOMMatrix reads; the identity is.
  const m = new DOMMatrix(computed.transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  return {
    opacity: Number(computed.opacity),
    x: m.m41,
    y: m.m42,
    rotate: (Math.atan2(m.m12, m.m11) * 180) / Math.PI,
    cx: Number.parseFloat(computed.getPropertyValue("cx")) || 0,
    r: Number.parseFloat(computed.getPropertyValue("r")) || 0,
    dash: Number.parseFloat(computed.getPropertyValue("stroke-dasharray")) || 0,
    scale: m.m11,
    width: el.getBoundingClientRect().width,
    top: el.getBoundingClientRect().top,
    css: el.getAnimations().length > 0,
  }
}

let runs = 0

/**
 * Every test shares one page: a hydration marks it done (`_$HY.done`), and `hydrate` then renders
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
  options: { readonly hydrateAfter?: number; readonly forMs: number; readonly then?: { readonly afterMs: number; readonly act: () => void } },
): Promise<Run> => {
  const renderId = `${name}-${runs++}`
  const { html, head, script, error } = await commands.serverRender2(file, name, renderId)
  if (error !== "") throw new Error(`server render of ${name} failed: ${error}`)
  expect(head, "the head carries the Appear style").toContain("data-wardic-appear")
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
  document.body.append(host)
  const watched = [...host.querySelectorAll("[data-k]")]
  let hydrated = false
  let dispose = (): void => {}
  cleanups.push(() => {
    dispose()
    host.remove()
    for (const style of styles) style.remove()
  })
  const startOf: Record<string, number> = {}
  // Each watched element's CSS animation's start, once it has one: a frame's read notes it, and so
  // does the Handoff, just before it takes them over, as a slow runner can skip every read before it (#524).
  // The page's, as a Batch's Handoff reads them: `find` passes over a Batch's rule (#706).
  const noteStarts = (): void => {
    const all = Appear.findAll(document)
    for (const el of watched) {
      const k = (el as HTMLElement).dataset.k!
      const animation = all.get(el)
      if (animation !== undefined && startOf[k] === undefined && typeof animation.startTime === "number") startOf[k] = animation.startTime
    }
  }
  const hydratedStyle: Record<string, string> = {}
  const frames: Array<Recorded> = []
  const begun = performance.now()
  if (options.then !== undefined) {
    const { afterMs, act } = options.then
    const timer = setTimeout(act, afterMs)
    cleanups.push(() => clearTimeout(timer))
  }
  const claimed: Record<string, boolean> = {}
  if (options.hydrateAfter !== undefined) {
    setTimeout(() => {
      freshHydration()
      noteStarts()
      dispose = hydrate(code, host, { renderId })
      hydrated = true
      for (const el of watched) {
        const k = (el as HTMLElement).dataset.k!
        hydratedStyle[k] = (el as HTMLElement).style.transform
        claimed[k] = host.querySelector(`[data-k="${k}"]`) === el
      }
    }, options.hydrateAfter)
  }
  // Read after the frame's callbacks, the engine's tick among them (the order of rAF callbacks is
  // the order they were asked for, and the engine asks each tick): a task posted from this frame's
  // callback runs after its paint. A read that runs after the next frame has started is skipped
  // (#184's late post-paint reads): it would show that frame's values.
  let frameCount = 0
  let counting = true
  const count = (): void => {
    frameCount++
    if (counting) requestAnimationFrame(count)
  }
  requestAnimationFrame(count)
  await new Promise<void>((resolve) => {
    const frame = (now: number): void => {
      const seen = frameCount
      setTimeout(() => {
        if (frameCount !== seen) return
        const drawn: Record<string, Drawn> = {}
        noteStarts()
        for (const el of watched) drawn[(el as HTMLElement).dataset.k!] = drawnOf(el)
        frames.push({ at: now, hydrated, drawn })
      }, 0)
      if (performance.now() - begun < options.forMs) requestAnimationFrame(frame)
      else setTimeout(resolve, 20)
    }
    requestAnimationFrame(frame)
  })
  counting = false
  return { frames, startOf, host, hydratedStyle, claimed }
}

/** The machine's values `seconds` in, as `Machine.startAt` draws them. */
export const machineAt = (machine: Machine.Machine<Frame.Frame<Values.Values>>, seconds: number): Values.Values =>
  Machine.startAt(machine, () => Math.max(0, seconds)).start()(1 / 60).value


/** Tolerances: a little over the sampler's own, for the browser's rounding. */
export const TOL = { opacity: 0.012, px: 0.6, deg: 1.5, dash: 0.006 }

/** Every frame of `k` against `expected(seconds since its CSS started)`; returns how many frames came after hydration. */
export const followsMachine = (
  r: Run,
  k: string,
  expected: (seconds: number) => { readonly opacity?: number; readonly x?: number; readonly y?: number; readonly rotate?: number; readonly cx?: number; readonly r?: number; readonly dash?: number },
): number => {
  const start = r.startOf[k]
  expect(start, `${k}'s CSS animation was found (frames read before hydration: ${r.frames.filter((f) => !f.hydrated).length})`).toBeDefined()
  let after = 0
  for (const frame of r.frames) {
    if (frame.at < start!) continue
    const seconds = (frame.at - start!) / 1000
    const want = expected(seconds)
    const got = frame.drawn[k]!
    const where = `${k} at ${seconds.toFixed(3)} s (${["before hydration", "hydrated"][Number(frame.hydrated)]})`
    if (want.opacity !== undefined) expect(Math.abs(got.opacity - want.opacity), `${where}: opacity ${got.opacity} vs ${want.opacity}`).toBeLessThanOrEqual(TOL.opacity)
    if (want.x !== undefined) expect(Math.abs(got.x - want.x), `${where}: x ${got.x} vs ${want.x}`).toBeLessThanOrEqual(TOL.px)
    if (want.y !== undefined) expect(Math.abs(got.y - want.y), `${where}: y ${got.y} vs ${want.y}`).toBeLessThanOrEqual(TOL.px)
    if (want.cx !== undefined) expect(Math.abs(got.cx - want.cx), `${where}: cx ${got.cx} vs ${want.cx}`).toBeLessThanOrEqual(TOL.px)
    if (want.r !== undefined) expect(Math.abs(got.r - want.r), `${where}: r ${got.r} vs ${want.r}`).toBeLessThanOrEqual(TOL.px)
    if (want.dash !== undefined) expect(Math.abs(got.dash - want.dash), `${where}: dash ${got.dash} vs ${want.dash}`).toBeLessThanOrEqual(TOL.dash)
    if (want.rotate !== undefined) {
      const diff = Math.abs((((got.rotate - want.rotate) % 360) + 540) % 360 - 180)
      expect(diff, `${where}: rotate ${got.rotate} vs ${want.rotate}`).toBeLessThanOrEqual(TOL.deg)
    }
    if (frame.hydrated) after++
  }
  return after
}

