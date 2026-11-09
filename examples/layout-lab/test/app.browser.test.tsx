/**
 * The lab's page, mounted as `main.tsx` mounts it (#681): it renders a card for every scenario, on
 * either binding (this file runs in `layout-lab-browser` and `layout-lab-browser-v2`). The page threw
 * `Service not found: @wardic/dom/ProjectionSystem` for a week with nothing failing: its tree panel
 * read the engine off the provider's runtime, which hasn't held it since the `layout` Feature (#548).
 */
import { BINDING, render } from "#binding"
import { scenarios } from "#scenarios"
import { afterEach, describe, expect, it } from "vitest"
import { makeLab } from "../src/lab/lab.ts"
import { frameTrace } from "../src/probe/frame-trace.ts"
import { makePaintSampler, startPostPaintTicker } from "../src/probe/paint-sampler.ts"
import { makeTimeline } from "../src/probe/timeline.ts"
import { App } from "../src/ui/App.tsx"

/** `n` Refresh frames. */
const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number) => {
      if (left === 0) return resolve()
      requestAnimationFrame(() => step(left - 1))
    }
    step(n)
  })

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
})

describe("the layout lab's page (#681)", () => {
  it("renders a card for every scenario, its tree panel reading the provider's engine", async () => {
    const ticker = startPostPaintTicker()
    const timeline = makeTimeline()
    ticker.onPostPaint((t) => timeline.notePaint(t))
    const sampler = makePaintSampler(ticker)
    const lab = makeLab({ ticker, sampler, timeline, frameTrace, scenarios, binding: BINDING })
    const root = document.createElement("div")
    document.body.append(root)
    const errors: Array<unknown> = []
    const onError = (event: ErrorEvent) => errors.push(event.error)
    window.addEventListener("error", onError)
    disposers.push(() => window.removeEventListener("error", onError))
    disposers.push(render(() => <App lab={lab} />, root))
    await frames(3)
    expect(errors).toEqual([])
    expect(root.querySelectorAll("article.card").length).toBe(lab.scenarios.length)
  })
})
