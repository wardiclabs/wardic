// The browser projects' shared commands (#806): `callerFrame` finds the calling test file's own iframe.
//
// - BC1: another file's iframe, of the same name and first in the page's frames, isn't the caller's.
// - BC2: the caller's iframe not on the page yet (the file before's still is): waited for as it navigates in,
//   another file's arriving first passed over.
// - BC3: the caller's iframe never on the page: at 10 s, not before, an error naming the file.
import * as Arr from "effect/Array"
import { describe, expect, it, vi } from "vitest"
import { type CallerContext, callerFrame } from "../browser-commands.ts"

/** A test iframe as vitest's orchestrator loads it: `/?sessionId=…&iframeId=<its file>`. */
const frameOf = (file: string) => ({ file, url: () => `http://localhost:63315/?sessionId=s1&iframeId=${encodeURIComponent(file)}` })

type FakeFrame = ReturnType<typeof frameOf>

/** A page holding `frames`, whose `navigate` adds one as Playwright's `framenavigated` reports it. */
const pageOf = (frames: Array<FakeFrame>): CallerContext<FakeFrame>["page"] & { readonly navigate: (frame: FakeFrame) => void } => {
  const waiters: Array<{ readonly isWanted: (frame: FakeFrame) => boolean; readonly arrive: (frame: FakeFrame) => void }> = []
  return {
    frames: () => frames,
    waitForEvent: (_event, options) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout ${options.timeout}ms exceeded while waiting for event "framenavigated"`)), options.timeout)
        waiters.push({
          isWanted: options.predicate,
          arrive: (frame) => {
            clearTimeout(timer)
            resolve(frame)
          },
        })
      }),
    navigate: (frame) => {
      frames.push(frame)
      Arr.forEach(waiters, (waiter) => {
        if (waiter.isWanted(frame)) waiter.arrive(frame)
      })
    },
  }
}

const INPUT_AMONG = "/repo/packages/dom/test/input-among.browser.test.ts"
const FILE_BEFORE = "/repo/packages/dom/test/projection-appear.browser.test.ts"
const FILE_AFTER = "/repo/packages/dom/test/scroll.browser.test.ts"

describe("callerFrame (#806)", () => {
  it("BC1: another file's iframe of the same name, first on the page, isn't the caller's", async () => {
    const page = pageOf([frameOf(FILE_BEFORE), frameOf(INPUT_AMONG)])
    const frame = await callerFrame({ page, testPath: INPUT_AMONG })
    expect(frame.file).toBe(INPUT_AMONG)
  })

  it("BC2: the caller's iframe not on the page yet is waited for, another file's arriving first passed over", async () => {
    const page = pageOf([frameOf(FILE_BEFORE)])
    const found = callerFrame({ page, testPath: INPUT_AMONG })
    page.navigate(frameOf(FILE_AFTER))
    page.navigate(frameOf(INPUT_AMONG))
    expect((await found).file).toBe(INPUT_AMONG)
  })

  it("BC3: the caller's iframe never on the page: at 10 s, not before, an error naming the file", async () => {
    vi.useFakeTimers()
    try {
      const found = callerFrame({ page: pageOf([frameOf(FILE_BEFORE)]), testPath: INPUT_AMONG })
      const settled = vi.fn()
      found.then(settled, settled)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(settled, "still waiting at 9,999 ms").not.toHaveBeenCalled()
      const failed = expect(found).rejects.toThrow(INPUT_AMONG)
      await vi.advanceTimersByTimeAsync(1)
      await failed
    } finally {
      vi.useRealTimers()
    }
  })
})
