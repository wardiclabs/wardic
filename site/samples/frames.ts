/**
 * The Batch samples' frame readout (#665): each second, the longest frame of it in ms, from the gaps
 * between `requestAnimationFrame`'s calls, told to `report`. Returns its stop.
 */
export const longestFrames = (report: (ms: number) => void): (() => void) => {
  let last = performance.now()
  let since = last
  let longest = 0
  let frame = 0
  const tick = (now: number): void => {
    longest = Math.max(longest, now - last)
    last = now
    if (now - since >= 1000) {
      report(Math.round(longest))
      longest = 0
      since = now
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
