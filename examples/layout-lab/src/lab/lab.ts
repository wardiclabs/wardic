/**
 * The lab orchestrator: it binds each scenario to a {@link ScenarioContext}, joins
 * a finished paint-sampler run with the timeline (framesToMeasure, the held frames,
 * the Wardic spans around it) and the frame trace (the Refresh frames,
 * ResizeObserver deliveries and inputs around it) into a {@link LabRun}, reads the
 * run's first steps and its pace through a second Measure pass, grades it against
 * the scenario's prediction, and keeps the bounded run log the UI and the copy-log
 * read. All of that runs once per completed run, never per frame.
 *
 * Framework-free on purpose (no Solid import): the UI subscribes through
 * {@link Lab.subscribe}, which fires once per completed run and never per frame,
 * so no Solid signal is written on the per-frame path.
 *
 * @module
 */
import {
  clearGhosts,
  DEFAULT_PAINT_SAMPLER_OPTIONS,
  type PaintSampler,
  type PostPaintTicker,
  type RunResult,
  type Verdict,
} from "../probe/paint-sampler.ts"
import type { FrameTrace, ObserverRecord } from "../probe/frame-trace.ts"
import { currentLabScheduler, type LabScheduler, type Mark, type SpanRecord, type Timeline } from "../probe/timeline.ts"
import type { Prediction, ScenarioContext, ScenarioDef, TriggerMeta } from "../scenarios/types.ts"
import { groupFrames, type InputJoin, joinInputs, type RefreshFrame } from "./frame-order.ts"
import { type ClockStart, type HeldFrom, heldFramesOf } from "./held-frames.ts"
import { measurePassesOf } from "./measure-passes.ts"
import { firstStepsOf, passStepRatioOf } from "./steps.ts"

/** How many completed runs the lab keeps (oldest dropped first). */
const MAX_RUNS = 200

/** The sampler's "same box" distance, which also decides whether a frame is still at the origin. */
const NEAR_PX = DEFAULT_PAINT_SAMPLER_OPTIONS.nearPx

/** How far before the trigger mark a run's span window reaches, in ms. */
const SPAN_LEAD_MS = 50

/**
 * How far before the trigger mark a run keeps inputs, in ms: enough for a hand
 * click's `pointerdown` (the `click` itself is usually the trigger), and for the
 * click that started a scenario whose trigger comes later (scenario 3's observer,
 * scenario 4's rAF).
 */
const INPUT_LEAD_MS = 500

/**
 * How much earlier than a run's trace window the trace is read, in ms, so a frame
 * whose first callback starts just inside the window is read whole (its later
 * callbacks all start within a few ms of its first).
 */
const FRAME_SLACK_MS = 20

/** The coordinator span whose end the lab treats as "a layout animation finished". */
const COORDINATOR_SPAN = "wardic.projection.coordinator"

/** The span each subscription to `Clock.ticks` runs in: one open means the Clock is ticking. */
const CLOCK_SPAN = "wardic.clock"

/**
 * How an observed verdict compares with the scenario's prediction.
 *
 * - `as-predicted`: `safe` + `clean`, or `flash-risk` + `flash`.
 * - `surprise`: `safe` + `flash`/`snap`, or `flash-risk` + `clean`/`snap`, or
 *   `wrong-origin` under either prediction (no scenario predicts a FLIP that starts
 *   off its path).
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
  /**
   * The label the scenario passed to `markTrigger`: the trigger path, plus any setup
   * it names (free play's `timing/mutation/path`, scenario 7's container mode).
   */
  readonly trigger: string
  /** The `meta` the scenario passed to `markTrigger`, when it passed one. */
  readonly triggerMeta?: TriggerMeta
  /** The scenario's prediction at the time of the run. */
  readonly prediction: Prediction
  /**
   * Paints between the trigger mark and the start of the first
   * `wardic.projection.measure` span after it. `null` when no measure span was
   * recorded (JSON has no `undefined`). Since #2's fix every layout trigger reads 0:
   * the Measure pass runs at the end of the triggering task or, for a change made
   * after the frame's gate flush, inside that frame before it paints (ADR-0018).
   */
  readonly framesToMeasure: number | null
  /**
   * Issues #14 and #2: painted frames held at the origin before the first motion,
   * counted from {@link heldFrom}. A layout change made in an ordinary task holds 0
   * (its first painted frame is already one step along); one measured after the
   * frame's gate flush holds 1 (that frame paints the origin); cold or warm alike
   * (ADR-0018). `null` when the anchor was never seen or nothing moved after it.
   */
  readonly heldFrames: number | null
  /** Milliseconds from {@link heldFrom} to the first moved frame's post-paint delivery; `null` like {@link heldFrames}. */
  readonly msToFirstMotion: number | null
  /** What {@link heldFrames} counts from: the first Measure pass, or (scenario 9) the trigger. */
  readonly heldFrom: HeldFrom
  /**
   * Issue #18: the first three step sizes of the run's motion, in px, starting at
   * its first step larger than 1px (see `firstStepsOf` in `steps.ts`). The origin
   * stands for the frame before the first sample, so a run whose first painted
   * frame already moved starts with that step. A layout FLIP's steps grow as its
   * spring speeds up (a click: `5.1 10.7 13.7`); #18's hesitation, a spring
   * restarted by a second Measure pass, read `5.1 4.9 10.3`. Empty when nothing
   * moved further than 1px in one step.
   */
  readonly firstSteps: ReadonlyArray<number>
  /**
   * ADR-0018's unchanged-node rule: across the two steps from the first sample
   * delivered at or after the run's second `wardic.projection.measure` span, each
   * step divided by the one before it, the ratio farthest from 1 (see
   * `passStepRatioOf` in `steps.ts`). About 1 when that pass left the running
   * animation alone (scenario 10: a sibling's resize mid-flight); well below 1 for
   * a restart or a held frame, above 1.6 for a skip ahead. `null` with fewer than
   * two Measure passes, when the second came before the first painted frame
   * (scenario 7), or when the element was not moving just before it.
   */
  readonly passStepRatio: number | null
  /**
   * The frame-stretch busy-wait in effect at the trigger, in ms (0 when off). A
   * stretched run is sampled at the stretched cadence, so a frame can go unsampled
   * and `heldFrames` read one short: judge its held count with that in mind.
   */
  readonly frameStretchMs: number
  /**
   * Whether the Clock was already ticking at the trigger (`warm`: some `wardic.clock`
   * span was open) or the run had to start it (`cold`). `null` for a run the lab
   * has no trigger record for.
   */
  readonly clock: ClockStart | null
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
  /**
   * Issues #2 and #18: every Refresh frame whose first callback started in the
   * run's trace window, oldest first, each with its callbacks in run order and its
   * `order` (e.g. `ticker>gate>clock|engine-ro`). The window is `[from, endedAt]`,
   * where `from` is the earlier of `triggerAt - 50` and the first of
   * {@link input}. The tags only resolve under the Vite dev server: under a
   * `vite build` every callback reads `other`. (Not to be confused with the painted
   * frames `framesToMeasure` and `heldFrames` count.)
   */
  readonly refreshFrames: ReadonlyArray<RefreshFrame>
  /** The ResizeObserver deliveries in the same window, oldest first. */
  readonly observerCallbacks: ReadonlyArray<ObserverRecord>
  /**
   * The `pointerdown`s and `click`s from `triggerAt - 500` to `endedAt`, each with
   * the first Refresh frame whose callbacks started after it was handled.
   */
  readonly input: ReadonlyArray<InputJoin>
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
  /** Whether the Keep Clock warm background spring was on when the log was produced. */
  readonly keepClockWarm: boolean
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
  /** The page's frame trace (`probe/frame-trace.ts`), installed before any other module evaluated. */
  readonly frameTrace: FrameTrace
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
  /** Zeroes the flash counts and removes every ghost outline (flash and wrong-origin). */
  readonly resetCounts: () => void
  /** Records the frame-stretch control's current value (ms), stamped on every run triggered after it. */
  readonly setFrameStretch: (ms: number) => void
  /** Builds the copy-log payload. It is JSON-round-trip safe. */
  readonly log: (meta: { readonly frameStretchMs: number; readonly keepClockWarm: boolean }) => LabLog
}

/** Grades `verdict` against `prediction` (see {@link Outcome}). */
export const outcomeOf = (prediction: Prediction, verdict: Verdict): Outcome => {
  if (prediction === "unknown") return "n/a"
  if (verdict === "no-move" || verdict === "timeout" || verdict === "interrupted") return "n/a"
  if (verdict === "wrong-origin") return "surprise"
  if (prediction === "safe") return verdict === "clean" ? "as-predicted" : "surprise"
  return verdict === "flash" ? "as-predicted" : "surprise"
}

/** The span that marks one Measure pass. */
const MEASURE_SPAN = "wardic.projection.measure"

/** A started run's trigger, kept until the run ends. */
interface PendingTrigger {
  readonly mark: Mark
  /** The `meta` passed to `markTrigger`, if any. */
  readonly meta: TriggerMeta | undefined
  /** `ticker.frame()` when the trigger was marked. */
  readonly frame: number
  /** Whether the Clock was already ticking when the trigger was marked. */
  readonly clock: ClockStart
  /** The frame stretch in effect when the trigger was marked, in ms. */
  readonly frameStretchMs: number
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
    const measure = timeline.window(after, result.endedAt).spans.find((s) => s.name === MEASURE_SPAN && s.start >= after)
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
  const { ticker, sampler, timeline, frameTrace, scenarios } = options
  // Recorded once, at startup: Effect chose its scheduler when its module loaded,
  // which happened before this module ran (see index.html).
  const scheduler: EffectScheduler = typeof globalThis.setImmediate === "function" ? "setImmediate" : "setTimeout-fallback"

  const framesToMeasureOf = framesToMeasureOfWith(timeline)
  const predictions = new Map<string, Prediction>(scenarios.map((def) => [def.id, def.prediction]))
  const heldFroms = new Map<string, HeldFrom>(scenarios.map((def) => [def.id, def.heldFramesFrom ?? "measure"]))
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
  // The frame-stretch control's value (ms), stamped on each run at its trigger.
  let frameStretchMs = 0

  sampler.onRunEnd((result) => {
    const trigger = pendingTriggers.get(result.triggerAt)
    pendingTriggers.delete(result.triggerAt)
    if (trigger !== undefined) awaitingDelivery.delete(trigger)
    const prediction = predictions.get(result.scenarioId) ?? "unknown"
    const frames = trigger === undefined ? undefined : framesToMeasureOf(trigger, result)
    const heldFrom = heldFroms.get(result.scenarioId) ?? "measure"
    const spans = timeline.window(result.triggerAt - SPAN_LEAD_MS, result.endedAt).spans
    const passes = measurePassesOf(spans, result.triggerAt)
    // `starts` is empty when no Measure pass answered the run, so index 0 or 1 may be missing.
    const anchorAt: number | undefined = heldFrom === "trigger" ? result.triggerAt : passes.starts[0]
    const secondPassAt: number | undefined = passes.starts[1]
    const held =
      anchorAt === undefined
        ? undefined
        : heldFramesOf(result.samples, result.origin, { from: heldFrom, at: anchorAt }, NEAR_PX)
    // The frame trace around the run: inputs from INPUT_LEAD_MS before the trigger,
    // and every frame whose first callback starts after the earlier of the first of
    // them and the span lead (read FRAME_SLACK_MS early, so that frame is whole).
    const trace = frameTrace.window(result.triggerAt - INPUT_LEAD_MS - FRAME_SLACK_MS, result.endedAt)
    const inputs = trace.inputs.filter((i) => i.t >= result.triggerAt - INPUT_LEAD_MS)
    const traceFrom = Math.min(result.triggerAt - SPAN_LEAD_MS, inputs[0]?.t ?? Number.POSITIVE_INFINITY)
    const refreshFrames = groupFrames(
      trace.callbacks.filter((c) => c.start >= traceFrom - FRAME_SLACK_MS),
      trace.observers,
    ).filter((f) => f.firstStart >= traceFrom)
    const observerCallbacks = trace.observers.filter((o) => o.start >= traceFrom)
    const run: LabRun = {
      ...result,
      trigger: trigger?.mark.label ?? "",
      // Omitted rather than `undefined`, so the run round-trips through JSON.
      ...(trigger?.meta === undefined ? {} : { triggerMeta: trigger.meta }),
      prediction,
      framesToMeasure: frames ?? null,
      heldFrames: held?.heldFrames ?? null,
      msToFirstMotion: held?.msToFirstMotion ?? null,
      heldFrom,
      firstSteps: firstStepsOf(result.origin, result.samples, NEAR_PX),
      passStepRatio: passStepRatioOf(result.origin, result.samples, secondPassAt, NEAR_PX),
      frameStretchMs: trigger?.frameStretchMs ?? frameStretchMs,
      clock: trigger?.clock ?? null,
      outcome: outcomeOf(prediction, result.verdict),
      spans,
      scheduler: currentLabScheduler(),
      refreshFrames,
      observerCallbacks,
      input: joinInputs(inputs, refreshFrames),
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
    markTrigger: (source, meta) => {
      const el = watched.get(id)
      if (el === undefined) {
        timeline.mark("note", `no watched element (${source})`, id)
        console.warn(`layout-lab: ${id} called markTrigger("${source}") before watch(); no run started`)
        return
      }
      // Read before the scenario's write starts anything: is the Clock already ticking?
      const clock: ClockStart = timeline.openCount(CLOCK_SPAN) > 0 ? "warm" : "cold"
      const mark = timeline.mark("trigger", source, id)
      const frame = ticker.frame()
      const pending: PendingTrigger = {
        mark,
        meta,
        frame,
        clock,
        frameStretchMs,
        lateEarlierFrames: [],
        frameDeliveredAt: undefined,
      }
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
    setFrameStretch: (ms) => {
      frameStretchMs = ms
    },
    log: ({ frameStretchMs, keepClockWarm }) => ({
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      frameStretchMs,
      keepClockWarm,
      scheduler,
      schedulerMode: currentLabScheduler(),
      runs: runs.slice(),
    }),
  }
}
