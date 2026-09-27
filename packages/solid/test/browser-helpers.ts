// Shared helpers for the real-browser test tier. The engine animates in REAL time
// (real rAF + real Effect scheduling); tests POLL real frames and assert robust
// INVARIANTS / settle states rather than exact per-frame values at a calibrated
// frame count. Most existing tests move elements via reactive CLASS; a reactive
// `style` prop is now tracked too (see wardic-create.browser.test.tsx), so either
// works for new tests.

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
export const paintedFrames = (el: Element, n: number): Promise<ReadonlyArray<DOMRect>> =>
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
    requestAnimationFrame(post)
  })

/** Poll every real frame until `done()` returns true, or `timeoutMs` elapses. */
export const until = async (done: () => boolean, timeoutMs = 4000): Promise<void> => {
  const start = performance.now()
  while (!done() && performance.now() - start < timeoutMs) await raf()
}
