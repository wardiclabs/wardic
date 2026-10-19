/**
 * A count of the page's Refresh frames, for the board recorders (#234's phone log): one rAF loop,
 * started on first use, adds one at the start of every frame. A recorder reads it in its own rAF
 * callback and again in the message it posts from there, which runs after that frame's paint; if
 * the count moved between them, the message ran late, after another frame started, and what it
 * read is that frame's (#184's late post-paint reads, which a phone does under load). Such a frame
 * is marked `late`, and the lines that compare one frame's reads skip it.
 *
 * The loop's callback is queued before any recorder's each frame: it queues its next during its
 * own callback, and a recorder queues its next after the paint.
 *
 * @module
 */

let count = 0
let running = false

/** The page's frame count now: the frame whose rAF callbacks last ran. */
export const frameNumber = (): number => {
  if (!running) {
    running = true
    const tick = (): void => {
      count++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  return count
}
