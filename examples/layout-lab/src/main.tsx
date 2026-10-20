/**
 * The lab's entry point. The probe pieces are created ONCE, at module scope, so
 * the post-paint ticker, the timeline and the sampler outlive every component and
 * start observing before the first scenario mounts.
 *
 * `window.__layoutLab` is assigned in dev AND production builds, so a scripted
 * smoke run (or a person in devtools) can read the runs and the log.
 *
 * The frame trace is imported FIRST: it wraps `requestAnimationFrame` and
 * `ResizeObserver` when it evaluates, and ES modules evaluate in import order, so
 * the wrappers are in place before any Wardic module runs.
 *
 * @module
 */
import { frameTrace } from "./probe/frame-trace.ts"
import "./styles.css"
import { BINDING, render } from "#binding"
import { scenarios } from "#scenarios"
import { type Lab, makeLab } from "./lab/lab.ts"
import { makePaintSampler, startPostPaintTicker } from "./probe/paint-sampler.ts"
import { makeTimeline } from "./probe/timeline.ts"
import { App } from "./ui/App.tsx"

declare global {
  interface Window {
    /** The running lab and its log builder, for scripted smoke runs and devtools. */
    __layoutLab?: { readonly lab: Lab; readonly log: Lab["log"] }
  }
}

const ticker = startPostPaintTicker()
const timeline = makeTimeline()
// Subscribed before the sampler, so the paint of the frame that ends a run is
// already in the paint log when the lab computes that run's framesToMeasure.
ticker.onPostPaint((t) => timeline.notePaint(t))
const sampler = makePaintSampler(ticker)
const lab = makeLab({ ticker, sampler, timeline, frameTrace, scenarios, binding: BINDING })

window.__layoutLab = { lab, log: lab.log }

const root = document.getElementById("root")
if (root === null) throw new Error("layout-lab: #root is missing from index.html")
render(() => <App lab={lab} />, root)
