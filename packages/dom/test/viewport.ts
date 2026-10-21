// Resizing the test iframe's viewport (`page.viewport`) and waiting for its `resize` event, for the
// tests of what a window resize does: the Resize block (#39) and the page-size refresh (#261).
import { page } from "vitest/browser"

// The last `page.viewport` command. `resizeTo` returns before it settles, so the next one
// waits for it: two never overlap (vitest settles every pending call on the first reply).
let command: Promise<void> = Promise.resolve()

/**
 * Resize the viewport to `w` × `h` and return once its `resize` event has run. It returns on
 * the event, not on `page.viewport`: under load the command's round trip can outlast the
 * engine's 250 ms block, with the event inside it, and the block's own pass then runs before
 * the test's trigger (#53). Its listener is added after the engine's, so the engine has seen
 * the change by then. No event within 1 s of the command settling fails it; a resize to the
 * current size fires none, and waits for none.
 */
export const resizeTo = async (w: number, h: number): Promise<void> => {
  await command
  if (window.innerWidth === w && window.innerHeight === h) return
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let onResize = (): void => {}
  try {
    await new Promise<void>((resolve, reject) => {
      onResize = () => {
        if (window.innerWidth === w && window.innerHeight === h) resolve()
      }
      window.addEventListener("resize", onResize)
      command = page.viewport(w, h).then(() => {
        if (!done) timer = setTimeout(() => reject(new Error(`no resize event for ${w}×${h} within 1 s of page.viewport`)), 1000)
      }, reject)
    })
  } finally {
    done = true
    clearTimeout(timer)
    window.removeEventListener("resize", onResize)
  }
}

/** The last `page.viewport` command has settled: await it after a test, so none runs into the next. */
export const viewportSettled = (): Promise<void> => command
