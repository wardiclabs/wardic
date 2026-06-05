// Shared helpers for the real-browser test tier. The engine animates in REAL time
// (real rAF + real Effect scheduling); tests POLL real frames and assert robust
// INVARIANTS / settle states rather than exact per-frame values at a calibrated
// frame count. Elements are moved via reactive CLASS (wardic.* does not yet track
// a reactive `style` prop for non-animated keys — a tracked follow-up).

/** Resolve after the next real animation frame. */
export const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

export const leftOf = (el: Element): number => el.getBoundingClientRect().left
export const topOf = (el: Element): number => el.getBoundingClientRect().top
export const widthOf = (el: Element): number => el.getBoundingClientRect().width
export const opacityOf = (el: HTMLElement): number => Number(el.style.opacity || "0")

/** Poll every real frame until `done()` returns true, or `timeoutMs` elapses. */
export const until = async (done: () => boolean, timeoutMs = 4000): Promise<void> => {
  const start = performance.now()
  while (!done() && performance.now() - start < timeoutMs) await raf()
}
