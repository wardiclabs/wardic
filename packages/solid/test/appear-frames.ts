// What an Appear hydration harness records (#48, ADR-0044): what each watched `data-k` element draws in
// every frame, read after the frame's paint, each one's CSS animation's start on the rAF timeline, and
// how a run's frames are checked against Wardic's own machine. Shared by both Solid bindings' harnesses
// (`appear-hydrate-harness.ts`, `v2/`) and the Foldkit binding's (`packages/foldkit/test/hydrate.ts`,
// #794): Solid-free. Not a test file itself.
import * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Effect from "effect/Effect"
import { expect } from "vitest"
import { uncounted } from "./appear-reads.ts"

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

/** A watched element's key: its `data-k`. */
const keyOf = (el: Element): string => (el as HTMLElement).dataset.k!

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

/**
 * Note each watched element's CSS animation's start into `startOf`, once it has one, from one read of
 * `page` (its document, or the shadow root holding its rules, #724), as a Batch's Handoff reads them:
 * `find` passes over a Batch's rule (#706). A frame's read notes it, and so does a harness just before it
 * hydrates, as a slow runner can skip every read before then (#524). The harness's own read, uncounted (#724).
 */
export const noteStarts = (page: Document | ShadowRoot, watched: ReadonlyArray<Element>, startOf: Record<string, number>): void =>
  uncounted(() => {
    const all = Appear.findAll(page)
    for (const el of watched) {
      const k = keyOf(el)
      const animation = all.get(el)
      if (animation !== undefined && startOf[k] === undefined && typeof animation.startTime === "number") startOf[k] = animation.startTime
    }
  })

/** What {@link recordFrames} records. */
export interface Recording {
  /** Where the watched elements' animations run: the document, or a shadow root holding their rules. */
  readonly page: Document | ShadowRoot
  /** The elements to read, asked at each frame: a hydration that rebuilds a subtree, or a render that adds an element, puts new ones under a key. */
  readonly watched: () => ReadonlyArray<Element>
  /** How long to record, from the first frame. */
  readonly forMs: number
  /** Whether hydration has run, read as each frame is recorded. */
  readonly hydrated: () => boolean
  /** Each watched element's CSS animation's start, noted as a frame's read finds it. */
  readonly startOf: Record<string, number>
}

/**
 * Record `forMs` of frames: what each watched element draws, read after the frame's callbacks, the
 * engine's tick among them (the order of rAF callbacks is the order they were asked for, and the engine
 * asks each tick): a task posted from this frame's callback runs after its paint. A read that runs after
 * the next frame has started is skipped (#184's late post-paint reads): it would show that frame's values.
 */
export const recordFrames = async (recording: Recording): Promise<ReadonlyArray<Recorded>> => {
  const { page, startOf } = recording
  const frames: Array<Recorded> = []
  const begun = performance.now()
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
        const watched = recording.watched()
        const drawn: Record<string, Drawn> = {}
        noteStarts(page, watched, startOf)
        uncounted(() => {
          for (const el of watched) drawn[keyOf(el)] = drawnOf(el)
        })
        frames.push({ at: now, hydrated: recording.hydrated(), drawn })
      }, 0)
      if (performance.now() - begun < recording.forMs) requestAnimationFrame(frame)
      else setTimeout(resolve, 20)
    }
    requestAnimationFrame(frame)
  })
  counting = false
  return frames
}

/** A tween's machine, as the server samples it and the client runs it: `Machine.animateValues` on the DOM's interpolators. */
export const tween = (from: Values.Values, to: Values.Values, options: Machine.AnimateOptions) =>
  Effect.runSync(Effect.provide(Machine.animateValues(from, to, options), DomInterpolators.layer))

/** The machine's values `seconds` in, as `Machine.startAt` draws them. */
export const machineAt = (machine: Machine.Machine<Frame.Frame<Values.Values>>, seconds: number): Values.Values =>
  Machine.startAt(machine, () => Math.max(0, seconds)).start()(1 / 60).value

/** Tolerances: a little over the sampler's own, for the browser's rounding. */
export const TOL = { opacity: 0.012, scale: 0.012, px: 0.6, deg: 1.5, dash: 0.006 }

/**
 * `frame`'s time since the frame `hydrate()` was called in, in seconds: how far an animation that hydration
 * starts can have got by that frame, at most. A read by a frame's index instead (the second hydrated frame,
 * say) counts frames, and a slow runner skips reads (#184): CI's second hydrated frame came five frames in (#854).
 */
export const sinceHydration = (hydratedAt: number | undefined, frame: Recorded | undefined): number => {
  expect(hydratedAt, "the run hydrated").toBeDefined()
  expect(frame, "a frame after hydration").toBeDefined()
  return (frame!.at - hydratedAt!) / 1000
}

/** A run as {@link followsMachine} reads it: its frames and each element's CSS animation's start. */
export interface Traced {
  readonly frames: ReadonlyArray<Recorded>
  readonly startOf: Readonly<Record<string, number>>
}

/** Every frame of `k` against `expected(seconds since its CSS started)`; returns how many frames came after hydration. */
export const followsMachine = (
  r: Traced,
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
