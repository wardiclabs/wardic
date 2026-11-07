/**
 * PROTOTYPE (#564 perf round; a seed for #562's viewer): a profiling layer for an Environment.
 *
 * It decorates the Environment's own services, so a frame is profiled with almost nothing added:
 * - **The Refresh frame source:** each Wardic callback in a frame is timed. That's two `now()`s a
 *   callback, and a frame has two (the Clock's, and the gate's when it asks). Their sum is
 *   **wardicMs**: the Clock's hand-off through Effect, every step and sink, and the gate's flush.
 * - **The Frame loop's own metrics** (`FrameLoop.layerMetrics`' slot, `MetricsGiven`), given
 *   objects that write into the profile instead of Effect Metrics. The loop already times its steps
 *   (**stepsMs**) and counts its runs (**animations**), so this costs nothing it doesn't already pay.
 * - **The Renderer:** every commit counted. With `detail`, each is timed too (**commitMs**), at two
 *   `now()`s a commit: the one probe here that changes what it measures (its cost is measured below).
 * - **The host's render:** `profile.render(fn)` times the host's own `renderer.render` (**renderMs**).
 *
 * `wardicMs − stepsMs` is what a frame costs around the steps: the Clock and Effect's hand-off, and
 * the gate's flush with its commits. Nothing here needs a DOM.
 */
import type * as RefreshFrameSource from "../../../packages/core/src/RefreshFrameSource.ts"
import * as Renderer from "../../../packages/core/src/Renderer.ts"
import { MetricsGiven } from "../../../packages/core/src/internal/frameLoop.ts"
import * as Layer from "effect/Layer"

export interface FrameRecord {
  ts: number
  wardicMs: number
  stepsMs: number
  commits: number
  commitMs: number
  renderMs: number
  animations: number
}

export interface Profiler {
  readonly frames: Array<FrameRecord>
  /** Wraps a Refresh frame source: provide the wrapped one to the Environment, below its Clock. */
  readonly source: <H>(inner: RefreshFrameSource.Shape<H>) => RefreshFrameSource.Shape<H>
  /** Wraps a Renderer's halves. */
  readonly renderer: (inner: Renderer.Renderer["Service"]) => Renderer.Renderer["Service"]
  /** The Frame loop's metrics slot, writing into the profile. Merge it beside the Environment. */
  readonly loopMetrics: Layer.Layer<never>
  /** Times the host's render, into the frame it ends. */
  readonly render: (draw: () => void) => void
  /** Medians and totals over the frames from `from`. */
  readonly summary: (from?: number) => Record<string, number>
  readonly mark: () => number
}

const now = () => performance.now()
const median = (xs: Array<number>) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export const makeProfiler = (options: { readonly detail?: boolean } = {}): Profiler => {
  const frames: Array<FrameRecord> = []
  let current: FrameRecord = { ts: -1, wardicMs: 0, stepsMs: 0, commits: 0, commitMs: 0, renderMs: 0, animations: 0 }
  const frameAt = (ts: number): FrameRecord => {
    if (current.ts !== ts) {
      current = { ts, wardicMs: 0, stepsMs: 0, commits: 0, commitMs: 0, renderMs: 0, animations: 0 }
      frames.push(current)
    }
    return current
  }

  const source = <H>(inner: RefreshFrameSource.Shape<H>): RefreshFrameSource.Shape<H> => ({
    requestFrame: (callback) =>
      inner.requestFrame((ts) => {
        const f = frameAt(ts)
        const t0 = now()
        callback(ts)
        f.wardicMs += now() - t0
      }),
    cancelFrame: inner.cancelFrame,
    now: inner.now,
  })

  const renderer = (inner: Renderer.Renderer["Service"]): Renderer.Renderer["Service"] => {
    const commit = inner.commit
    if (options.detail === true) {
      return {
        project: inner.project,
        commit: (target, patch) => {
          const t0 = now()
          commit(target, patch)
          current.commitMs += now() - t0
          current.commits++
        },
      }
    }
    return {
      project: inner.project,
      commit: (target, patch) => {
        commit(target, patch)
        current.commits++
      },
    }
  }

  // The loop calls `updateUnsafe(value, context)` on each; these write into the frame instead.
  const metric = (write: (v: number) => void) => ({ updateUnsafe: (v: number) => write(v) })
  const loopMetrics = Layer.succeed(MetricsGiven, {
    animations: metric((v) => { current.animations = v }),
    settled: metric(() => {}),
    failed: metric(() => {}),
    tickMs: metric((v) => { current.stepsMs += v }),
  } as never)

  const render = (draw: () => void) => {
    const t0 = now()
    draw()
    current.renderMs += now() - t0
  }

  const summary = (from = 0) => {
    const fs = frames.slice(from).filter((f) => f.wardicMs > 0)
    return {
      frames: fs.length,
      wardicMs: +median(fs.map((f) => f.wardicMs)).toFixed(4),
      stepsMs: +median(fs.map((f) => f.stepsMs)).toFixed(4),
      aroundStepsMs: +median(fs.map((f) => f.wardicMs - f.stepsMs)).toFixed(4),
      commits: median(fs.map((f) => f.commits)),
      commitMs: +median(fs.map((f) => f.commitMs)).toFixed(4),
      renderMs: +median(fs.map((f) => f.renderMs)).toFixed(4),
      animations: median(fs.map((f) => f.animations)),
    }
  }

  return { frames, source, renderer, loopMetrics, render, summary, mark: () => frames.length }
}
