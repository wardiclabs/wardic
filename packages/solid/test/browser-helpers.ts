// Shared helpers for the real-browser test tier. The engine animates in REAL time
// (real rAF + real Effect scheduling); tests POLL real frames and assert robust
// INVARIANTS / settle states rather than exact per-frame values at a calibrated
// frame count. Most existing tests move elements via reactive CLASS; a reactive
// `style` prop is now tracked too (see wardic-create.browser.test.tsx), so either
// works for new tests.

import { expect } from "vitest"

/** Resolve after the next real animation frame. */
export const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

export const leftOf = (el: Element): number => el.getBoundingClientRect().left
export const topOf = (el: Element): number => el.getBoundingClientRect().top
export const widthOf = (el: Element): number => el.getBoundingClientRect().width
export const opacityOf = (el: HTMLElement): number => Number(el.style.opacity || "0")

/**
 * Resolve in a task after the next frame has painted — where a click lands. A test
 * that triggers right after `await raf()` instead runs inside that rAF callback's
 * microtask, mid-frame, so the gate's pass can land in the frame being rendered.
 */
export const afterPaint = async (): Promise<void> => {
  await raf()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * The boxes `el` paints in the next `n` Refresh frames, each read just after its
 * paint: every rAF posts a `MessageChannel` message, whose handler runs after that
 * frame's rendering update (the layout lab's post-paint method). A read inside a
 * rAF callback instead depends on callback order — queued ahead of the gate's
 * flush, it sees the previous frame's paint. Call it right after the trigger.
 */
export const paintedFrames = (el: Element, n: number): Promise<ReadonlyArray<DOMRect>> => paintedReads(() => el.getBoundingClientRect(), n)

/** {@link paintedFrames}, reading whatever `read` reads after each of the next `n` paints. */
export const paintedReads = <A>(read: () => A, n: number): Promise<ReadonlyArray<A>> =>
  new Promise((resolve) => {
    const reads: Array<A> = []
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      reads.push(read())
      if (reads.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(reads)
    }
    requestAnimationFrame(post)
  })

/**
 * {@link paintedFrames}, started from INSIDE a Refresh frame's rendering update (a
 * ResizeObserver callback, a rAF callback, a Clock tick, an effect in the gate's
 * flush): the first message is posted at once, so the first box is read just after
 * the paint of the frame the caller is running in. Called from an ordinary task it
 * would read before the next frame instead, so use it only inside a frame.
 */
export const paintedFramesFromHere = (el: Element, n: number): Promise<ReadonlyArray<DOMRect>> =>
  new Promise((resolve) => {
    const boxes: Array<DOMRect> = []
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      boxes.push(el.getBoundingClientRect())
      if (boxes.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(boxes)
    }
    post()
  })

/** One post-paint read: when it ran (`performance.now()`) and the box it saw. */
export interface PaintedSample {
  readonly t: number
  readonly box: DOMRect
}

/** {@link paintedFrames} with each read's time, so a test can find the frames around a mid-flight trigger. */
export const paintedTimedFrames = (el: Element, n: number): Promise<ReadonlyArray<PaintedSample>> =>
  new Promise((resolve) => {
    const samples: Array<PaintedSample> = []
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      samples.push({ t: performance.now(), box: el.getBoundingClientRect() })
      if (samples.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(samples)
    }
    requestAnimationFrame(post)
  })

/**
 * Poll every real frame until `done()` returns true; at `timeoutMs`, fail, naming the condition
 * (`what`, else `done`'s source), so a wait that never ends can't pass on what follows it (#460).
 * A test that waits on purpose, up to a time or until something, uses `waitAtMost`.
 */
export const until = async (done: () => boolean, timeoutMs = 4000, what?: string): Promise<void> => {
  const start = performance.now()
  while (!done()) {
    if (performance.now() - start >= timeoutMs) throw new Error(`until: ${what ?? String(done)} still false after ${timeoutMs} ms`)
    await raf()
  }
}

/**
 * Poll every real frame until `done()` returns true or `timeoutMs` elapses, whichever comes first: a
 * deliberate wait, not a check. Without `done`, it waits the whole time. Returns whether `done()` held.
 */
export const waitAtMost = async (timeoutMs: number, done: () => boolean = () => false): Promise<boolean> => {
  const start = performance.now()
  while (!done() && performance.now() - start < timeoutMs) await raf()
  return done()
}

/**
 * Lose the next `pointerup` on purpose (#31): a window capture-phase listener that
 * stops it before anything else sees it, then removes itself. Register it BEFORE the
 * press: the DOM Environment adds its own window listener at the down, and a listener
 * registered earlier on the same target runs first, so `stopImmediatePropagation`
 * keeps the release from every Wardic listener, as another page script could. Returns
 * a disposer for a test that ends before the release.
 */
export const loseNextRelease = (): (() => void) => {
  const swallow = (e: Event): void => {
    e.stopImmediatePropagation()
    window.removeEventListener("pointerup", swallow, true)
  }
  window.addEventListener("pointerup", swallow, true)
  return () => window.removeEventListener("pointerup", swallow, true)
}

/**
 * Start a synthetic gesture and retry it until `took()`: the recognizer attaches its
 * listener asynchronously, so the first events can arrive before it listens. Each
 * attempt waits `frames` frames before it is judged, and a retry releases first, so a
 * gesture that did start is never pressed again: a second down from the pointer that
 * holds a drag ends it and starts another (ADR-0019).
 */
export const retryGesture = async (
  press: () => void,
  release: () => void,
  took: () => boolean,
  frames = 3,
  timeoutMs = 4000,
): Promise<void> => {
  const start = performance.now()
  for (let attempt = 0; performance.now() - start < timeoutMs; attempt++) {
    if (attempt > 0) release()
    press()
    for (let f = 0; f < frames; f++) {
      await raf()
      if (took()) return
    }
  }
}

/**
 * The frame a callback runs in, as its timeline time: inside a frame, `document.timeline.currentTime` is
 * that frame's timestamp, and a task after its paint still reads it (#673's probe), so the post-paint
 * read of the same frame carries the same time. The gate writes 6 significant digits, so a tween's last
 * step but one already reads as its target: a value can't tell the landing frame, its callback can (#680).
 */
export const frameNow = (): number => document.timeline.currentTime as number

/** The index of the {@link paintedReads} read, each led by its {@link frameNow}, taken after the paint of frame `at`. */
export const readOf = <A extends readonly [number, ...ReadonlyArray<unknown>]>(reads: ReadonlyArray<A>, at: number | undefined): number => {
  const i = reads.findIndex(([t]) => t === at)
  expect(i, "the callback's frame is among the reads").toBeGreaterThan(0)
  return i
}

/**
 * A start's painted positions, from its first frame: moved by a single step there, off the origin and
 * short of the destination, and the next step larger (from rest; a doubled first step isn't) (#680).
 */
export const expectMovedFirst = (xs: ReadonlyArray<number>, origin: number, destination: number): void => {
  expect(Math.abs(xs[0]! - origin), "the first frame moved").toBeGreaterThan(0.01)
  expect(Math.abs(xs[0]! - destination)).toBeGreaterThan(1)
  expect(Math.abs(xs[1]! - xs[0]!), "a single first step: the second is larger").toBeGreaterThan(Math.abs(xs[0]! - origin))
}

/** `frames` frames of `read`, read after each. */
export const over = async <A>(frames: number, read: () => A): Promise<ReadonlyArray<A>> => {
  const out: Array<A> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push(read())
  }
  return out
}
