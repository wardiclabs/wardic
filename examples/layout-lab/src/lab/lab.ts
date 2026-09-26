/**
 * The lab orchestrator: it binds each scenario to a {@link ScenarioContext}, joins
 * a finished paint-sampler run with the timeline (framesToMeasure, the Wardic spans
 * around it) into a {@link LabRun}, grades it against the scenario's prediction,
 * and keeps the bounded run log the UI and the copy-log read.
 *
 * Framework-free on purpose (no Solid import): the UI subscribes through
 * {@link Lab.subscribe}, which fires once per completed run and never per frame,
 * so no Solid signal is written on the per-frame path.
 *
 * @module
 */
import {
  clearGhosts,
  type PaintSampler,
  type PostPaintTicker,
  type RunResult,
  type Verdict,
} from "../probe/paint-sampler.ts"
import { currentLabScheduler, type LabScheduler, type Mark, type SpanRecord, type Timeline } from "../probe/timeline.ts"
import type { Prediction, ScenarioContext, ScenarioDef } from "../scenarios/types.ts"

/** How many completed runs the lab keeps (oldest dropped first). */
const MAX_RUNS = 200

/** How far before the trigger mark a run's span window reaches, in ms. */
const SPAN_LEAD_MS = 50

/** The coordinator span whose end the lab treats as "a layout animation finished". */
const COORDINATOR_SPAN = "wardic.projection.coordinator"

/**
 * How an observed verdict compares with the scenario's prediction.
 *
 * - `as-predicted`: `safe` + `clean`, or `flash-risk` + `flash`.
 * - `surprise`: `safe` + `flash`/`snap`, or `flash-risk` + `clean`/`snap`.
 * - `n/a`: an `unknown` prediction, or a verdict that says nothing about flashing
 *   (`no-move`, `timeout`, `interrupted`).
 */
export type Outcome = "as-predicted" | "surprise" | "n/a"

/**
 * One completed run: the sampler's {@link RunResult} plus what the lab joined onto
 * it. Every field is a number, string, plain object or array, so a log of runs
 * survives a JSON round trip unchanged.
 */
export interface LabRun extends RunResult {
  /** The scenario's prediction at the time of the run. */
  readonly prediction: Prediction
  /**
   * Paints between the trigger mark and the start of the first
   * `wardic.projection.measure` span after it. `null` when no measure span was
   * recorded (JSON has no `undefined`).
   */
  readonly framesToMeasure: number | null
  /** The verdict graded against the prediction. */
  readonly outcome: Outcome
  /**
   * The recorded `wardic.*` spans that start in `[triggerAt - 50, endedAt]`. A
   * span still in flight when the run ended (usually the coordinator) is completed
   * in place when it ends, so a log copied later carries its `end`.
   */
  readonly spans: ReadonlyArray<SpanRecord>
  /** The page's scheduler mode (`?scheduler=`) the run was captured under. */
  readonly scheduler: LabScheduler
}

/** Flash totals since the last {@link Lab.resetCounts}. */
export interface FlashCounts {
  /** Flash verdicts across every scenario. */
  readonly total: number
  /** Flash verdicts per scenario id (scenarios with none are absent). */
  readonly perScenario: Readonly<Record<string, number>>
}

/**
 * Which task scheduler Effect picked when it loaded: `setImmediate` when the
 * `?scheduler=microtask` polyfill was installed, `setTimeout-fallback` otherwise
 * (a real browser, which has no `setImmediate`).
 */
export type EffectScheduler = "setTimeout-fallback" | "setImmediate"

/** The copy-log payload: environment metadata plus every kept run. */
export interface LabLog {
  /** When the log was produced (ISO 8601). */
  readonly createdAt: string
  readonly userAgent: string
  readonly devicePixelRatio: number
  /** The frame-stretch busy-wait in effect when the log was produced, in ms. */
  readonly frameStretchMs: number
  /** Which scheduler Effect is running on (see {@link EffectScheduler}). */
  readonly scheduler: EffectScheduler
  /**
   * The page's scheduler mode, from `?scheduler=`: `default` is real-app timing,
   * `microtask` is the browser test harness's timing. It always matches
   * {@link scheduler} (`microtask` installs the `setImmediate` polyfill).
   */
  readonly schedulerMode: LabScheduler
  /** The kept runs, oldest first. */
  readonly runs: ReadonlyArray<LabRun>
}

/** Everything the lab is built from. Each piece is created once, at module scope. */
export interface LabOptions {
  readonly ticker: PostPaintTicker
  readonly sampler: PaintSampler
  readonly timeline: Timeline
  readonly scenarios: ReadonlyArray<ScenarioDef>
}

/** The lab orchestrator (see the module doc). */
export interface Lab {
  /** The shared post-paint ticker (the frame-stretch control subscribes to it). */
  readonly ticker: PostPaintTicker
  /** The timeline the Wardic tracer records into. */
  readonly timeline: Timeline
  /** The scenarios, in display order. */
  readonly scenarios: ReadonlyArray<ScenarioDef>
  /** The context for `def`, bound to `def.id`. The same object is returned on every call. */
  readonly context: (def: ScenarioDef) => ScenarioContext
  /** The kept runs, oldest first (a copy). */
  readonly runs: () => ReadonlyArray<LabRun>
  /** Calls `cb` once per completed run. Returns an unsubscribe function. */
  readonly subscribe: (cb: (run: LabRun) => void) => () => void
  /** Flash totals since the last reset. */
  readonly flashCounts: () => FlashCounts
  /** Zeroes the flash counts and removes every flash ghost outline. */
  readonly resetCounts: () => void
  /** Builds the copy-log payload. It is JSON-round-trip safe. */
  readonly log: (meta: { readonly frameStretchMs: number }) => LabLog
}

/** Grades `verdict` against `prediction` (see {@link Outcome}). */
export const outcomeOf = (prediction: Prediction, verdict: Verdict): Outcome => {
  if (prediction === "unknown") return "n/a"
  if (verdict === "no-move" || verdict === "timeout" || verdict === "interrupted") return "n/a"
  if (prediction === "safe") return verdict === "clean" ? "as-predicted" : "surprise"
  return verdict === "flash" ? "as-predicted" : "surprise"
}

/** The span that marks one measure pass. */
const MEASURE_SPAN = "wardic.projection.measure"

/** A started run's trigger, kept until the run ends. */
interface PendingTrigger {
  readonly mark: Mark
  /** `ticker.frame()` when the trigger was marked. */
  readonly frame: number
  /**
   * Delivery times of frames numbered before {@link frame} whose post-paint
   * delivery only ran after the trigger. Those frames painted before it.
   */
  readonly lateEarlierFrames: Array<number>
  /** The delivery time of {@link frame} itself, when it ran after the trigger. */
  frameDeliveredAt: number | undefined
}

/**
 * The run's framesToMeasure: `Timeline.framesToMeasure`, corrected for a race.
 *
 * The timeline stamps each paint with the time its post-paint delivery ran. When
 * deliveries are still pending at the trigger (a click task can run between a
 * frame's paint and that frame's delivery), they arrive after the trigger, so the
 * timeline counts paints that actually happened before it. The lab records those
 * late deliveries by frame number:
 *
 * - a frame numbered before the trigger frame always painted before the trigger;
 * - the trigger frame itself painted before it exactly when the sampler (which
 *   decides this with its IntersectionObserver probe, see the paint-sampler module
 *   doc) did not take it as the first sample.
 *
 * Every such delivery that the timeline counted (before the first measure pass) is
 * taken back out.
 */
const framesToMeasureOfWith =
  (timeline: Timeline) =>
  (trigger: PendingTrigger, result: RunResult): number | undefined => {
    const raw = timeline.framesToMeasure(trigger.mark)
    if (raw === undefined) return undefined
    const after = trigger.mark.t
    const measure = timeline.window(after, result.endedAt).spans.find((s) => s.name === MEASURE_SPAN && s.start > after)
    if (measure === undefined) return raw
    const first = result.samples[0]
    const triggerFramePaintedBefore =
      trigger.frameDeliveredAt !== undefined && (first === undefined || first.frame > trigger.frame)
    const late =
      triggerFramePaintedBefore && trigger.frameDeliveredAt !== undefined
        ? [...trigger.lateEarlierFrames, trigger.frameDeliveredAt]
        : trigger.lateEarlierFrames
    const counted = late.filter((t) => t > after && t < measure.start).length
    return Math.max(0, raw - counted)
  }

/** Builds the lab. Call it once. */
export const makeLab = (options: LabOptions): Lab => {
  const { ticker, sampler, timeline, scenarios } = options
  // Recorded once, at startup: Effect chose its scheduler when its module loaded,
  // which happened before this module ran (see index.html).
  const scheduler: EffectScheduler = typeof globalThis.setImmediate === "function" ? "setImmediate" : "setTimeout-fallback"

  const framesToMeasureOf = framesToMeasureOfWith(timeline)
  const predictions = new Map<string, Prediction>(scenarios.map((def) => [def.id, def.prediction]))
  const watched = new Map<string, HTMLElement>()
  const contexts = new Map<string, ScenarioContext>()
  // Every started run that has not ended yet, keyed by its trigger mark's
  // timestamp (RunResult.triggerAt is that timestamp).
  const pendingTriggers = new Map<number, PendingTrigger>()
  // The last frame whose post-paint delivery ran, and the triggers still waiting
  // for their own frame's delivery (see framesToMeasureOfWith). This is the lab's
  // only per-frame work: one assignment, plus a loop over a set that is empty
  // except in the frame or two after a trigger.
  let deliveredFrame = 0
  const awaitingDelivery = new Set<PendingTrigger>()
  ticker.onPostPaint((t, frame) => {
    deliveredFrame = frame
    for (const pending of awaitingDelivery) {
      if (frame < pending.frame) {
        pending.lateEarlierFrames.push(t)
        continue
      }
      if (frame === pending.frame) pending.frameDeliveredAt = t
      awaitingDelivery.delete(pending)
    }
  })

  const runs: Array<LabRun> = []
  const listeners = new Set<(run: LabRun) => void>()
  let flashTotal = 0
  let flashPerScenario: Record<string, number> = {}

  sampler.onRunEnd((result) => {
    const trigger = pendingTriggers.get(result.triggerAt)
    pendingTriggers.delete(result.triggerAt)
    if (trigger !== undefined) awaitingDelivery.delete(trigger)
    const prediction = predictions.get(result.scenarioId) ?? "unknown"
    const frames = trigger === undefined ? undefined : framesToMeasureOf(trigger, result)
    const run: LabRun = {
      ...result,
      prediction,
      framesToMeasure: frames ?? null,
      outcome: outcomeOf(prediction, result.verdict),
      spans: timeline.window(result.triggerAt - SPAN_LEAD_MS, result.endedAt).spans,
      scheduler: currentLabScheduler(),
    }
    runs.push(run)
    if (runs.length > MAX_RUNS) runs.splice(0, runs.length - MAX_RUNS)
    if (run.verdict === "flash") {
      flashTotal += 1
      flashPerScenario = { ...flashPerScenario, [run.scenarioId]: (flashPerScenario[run.scenarioId] ?? 0) + 1 }
    }
    for (const cb of listeners) {
      try {
        cb(run)
      } catch (error) {
        console.error("layout-lab: a run listener threw", error)
      }
    }
  })

  const makeContext = (id: string): ScenarioContext => ({
    watch: (el) => {
      watched.set(id, el)
      if (sampler.activeScenarioId() === id) sampler.retarget(el)
    },
    markTrigger: (source) => {
      const el = watched.get(id)
      if (el === undefined) {
        timeline.mark("note", `no watched element (${source})`, id)
        console.warn(`layout-lab: ${id} called markTrigger("${source}") before watch(); no run started`)
        return
      }
      const mark = timeline.mark("trigger", source, id)
      const frame = ticker.frame()
      const pending: PendingTrigger = { mark, frame, lateEarlierFrames: [], frameDeliveredAt: undefined }
      pendingTriggers.set(mark.t, pending)
      if (deliveredFrame < frame) awaitingDelivery.add(pending)
      sampler.begin({ el, scenarioId: id, triggerAt: mark.t })
    },
    mark: (label) => {
      timeline.mark("note", label, id)
    },
    onLayoutAnimationComplete: (cb) =>
      timeline.onSpanEnd((span) => {
        if (span.name === COORDINATOR_SPAN) cb()
      }),
  })

  const context: Lab["context"] = (def) => {
    let ctx = contexts.get(def.id)
    if (ctx === undefined) {
      ctx = makeContext(def.id)
      contexts.set(def.id, ctx)
    }
    return ctx
  }

  return {
    ticker,
    timeline,
    scenarios,
    context,
    runs: () => runs.slice(),
    subscribe: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    flashCounts: () => ({ total: flashTotal, perScenario: flashPerScenario }),
    resetCounts: () => {
      flashTotal = 0
      flashPerScenario = {}
      clearGhosts()
    },
    log: ({ frameStretchMs }) => ({
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      frameStretchMs,
      scheduler,
      schedulerMode: currentLabScheduler(),
      runs: runs.slice(),
    }),
  }
}
