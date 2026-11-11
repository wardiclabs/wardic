/**
 * The Batch samples' frame rate (#665): each second, how many frames the page drew in it, from
 * `requestAnimationFrame`'s calls, told to `report` as frames per second. Returns its stop.
 */
export const framesPerSecond = (report: (fps: number) => void): (() => void) => {
  let since = performance.now()
  let frames = 0
  let frame = 0
  const tick = (now: number): void => {
    frames++
    if (now - since >= 1000) {
      report(Math.round((frames * 1000) / (now - since)))
      frames = 0
      since = now
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
