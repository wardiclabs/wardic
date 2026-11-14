/**
 * The **Frame loop**'s implementation (ADR-0027), behind the `FrameLoop` module's service and
 * `layer` (ADR-0028, decision 11): one fiber per burst that steps every running
 * Primitive's machine once per tick, in one pass, and hands each its Frame. Each animation used
 * to be a fiber running its own `Stream`; at 1,000 elements that machinery was about 90% of a
 * Primitive's per-frame cost.
 *
 * - **A run** is `run(machine, sink)`: an entry added, its Frames handed to `sink` from the loop's
 *   next tick (or its Late step, below), and its settled Frame returned. `acquireUseRelease` removes the entry on every
 *   exit (a settle, an interruption, a defect), so interrupting a run removes it at once. A run
 *   given a token (`run(machine, sink, { supersede })`, #200) joins it, and `Supersede.end` takes
 *   it off at once too, completing its fiber with `Superseded`: no interrupt, and no interrupt
 *   cause for every finalizer to combine (ADR-0027, *Amendment (#200)*).
 * - **A burst** is the loop's one `Clock.ticks` subscription, held in a `FiberHandle` and forked
 *   under the Layer's build context (never a caller's scheduler or span, the Clock's own rule,
 *   ADR-0017). The first run starts it; it ends itself at the first tick with nothing left, so
 *   a Retarget (a removal, then an add, in one call) keeps it, and the Clock goes idle at its
 *   next Refresh frame. The Layer's `Scope` closing interrupts it.
 * - **A tick** steps the entries the tick began with: an entry added during it (from a sink)
 *   isn't stepped by it, and one removed during it gets no Frame. It steps them in add
 *   order, those added with `runLast` after all the others (ADR-0027, *Amendment (#137)*). A step or sink that
 *   throws ends only its own run (`Exit.die`); a failure of the loop itself fails every run
 *   still on it, and the next run starts a fresh burst. That includes a run a continuation
 *   starts while the ending burst resumes its runs (#81).
 * - **The end of a tick** calls each `afterTick` hook, with the tick's dt, after every step and sink
 *   and the continuations of the runs that settled in it, the tick that ends a burst included. The flush
 *   gate flushes there, so a value paints in the Refresh frame that computed it (ADR-0033). A run
 *   a hook starts keeps the burst: whether it ends is counted after the hooks (#209).
 * - **The Late window** runs from a tick's first step until a microtask the tick queues at its end
 *   (ADR-0027 *Amendment (#680)*): what starts in it is drawn in that tick's Refresh frame, after the
 *   tick. A run `run` added in it, during the tick or in a microtask the tick's own code queued (Solid
 *   2's effects, a promise it resolved), takes its **Late step** in that microtask: one step at the
 *   tick's dt, and the hooks again, so the frame paints it, not its origin. A round whose steps or hooks
 *   add more runs is followed by another, at most `MAX_LATE_ROUNDS`; the rest step at the next tick. A
 *   `runLast` run takes none: the projection's coordinator, its one caller, would step again the nodes
 *   an after-tick Measure pass already stepped. One the tick stepped steps again at dt 0 after a round
 *   that stepped a `run` run, so it reads what that round wrote.
 *   `inLateWindow()` reads it, for the projection's Measure pass (ADR-0018 *Amendment (#673)*).
 *
 * Observability: a span per run, named after its Primitive (`machine.span`), and one per burst
 * (`wardic.frameloop`). A run's `<name>: start` debug log, annotated with its span's attributes,
 * built only when a Debug log would be kept (#542). Per tick, no span or log. With the metrics an app
 * gives (`FrameLoop.layerMetrics`, #518): a gauge of running animations and a histogram of ms per tick,
 * each one `updateUnsafe` (ADR-0027, decision 6), and the runs that settled or failed in it, counted as
 * they end and added at its end by the loop's own `afterTick` hook, its first (#542). The histogram ends
 * before the hooks, so it measures the steps alone, not the gate's flush (ADR-0033).
 *
 * A run's span is opened without a stack frame (ADR-0040, decision 3): `useSpan` with the span as
 * the `ParentSpan`, not `withSpan`, whose frame Effect stamps on an interrupted run's cause and
 * hashes in every finalizer it passes. So the loop names a run's defect itself, with a frame of
 * the run's name (ADR-0030, decision 3). No span here captures a call-site stack (decision 2).
 *
 * The dev check for non-finite Frames (`CheckFrames`, ADR-0030 decision 7) is a sink wrapper a
 * run gets at its start when the check is on, so the tick is the same either way.
 *
 * Internal (ADR-0028, decision 11): the service's shape (`run`, `runLast`, `afterTick`,
 * `inLateWindow`) and `make`, behind `FrameLoop.layer`.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import * as FiberHandle from "effect/FiberHandle"
import { constUndefined, identity } from "effect/Function"
import * as LogLevel from "effect/LogLevel"
import type * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as References from "effect/References"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Tracer from "effect/Tracer"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Clock from "../Clock.ts"
import type * as Frame from "../Frame.ts"
import * as Supersede from "../Supersede.ts"
import type * as FrameLoop from "../FrameLoop.ts"
import type * as Machine from "../Machine.ts"
import { none, SpansGiven, traced } from "./tracing.ts"

// @wardic/core compiles against ES2022 alone, which does not declare `performance` (see
// refresh-frame-clock.ts). It is a host global in every Environment Wardic targets.
declare const performance: { readonly now: () => number }
// The same for `queueMicrotask` (see Microtask.ts): the Late window's end (#680).
declare const queueMicrotask: (callback: () => void) => void

/** A run's options: the token it joins, so its caller can end it with others. */
// #200.
export interface RunOptions {
  /** The token: `Supersede.end` on it ends every run that joined it. */
  readonly supersede: Supersede.Supersede
}

/** `run`'s and `runLast`'s shape: a run given a token can also end `Superseded`. */
export interface Run {
  <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>): Effect.Effect<F>
  <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>, options: RunOptions): Effect.Effect<F | Supersede.Superseded>
}

/** The Frame loop's members: what `FrameLoop` gives. */
export interface Shape {
  /**
   * Runs `machine` on the loop, handing each of its Frames to `sink`, from the loop's next tick until it
   * settles; added in the loop's Late window, from its Late step there. Succeeds with the settled Frame; a machine that never settles, `chase`, runs until it's
   * interrupted or superseded. Dies with the defect if its step or its sink throws. Interrupting it
   * removes it at once.
   *
   * Given a `Supersede` token (`{ supersede }`), the run joins it, and `Supersede.end(token)` ends it at
   * once, as an interrupt would, but its fiber succeeds with `Superseded`.
   */
  // One span per run, named after its Primitive. #200: no interrupt cause to build; its span ends with
  // `superseded: true`.
  readonly run: Run
  /**
   * `run`, but stepped after every run `run` added, in each tick: for a machine that reads what the
   * others' sinks wrote in the same tick. Among themselves, these runs step in the order they were added.
   * One added in the Late window takes no Late step: its first step is the next tick. One the tick
   * stepped steps again at dt 0 after a Late round that stepped a `run` run.
   */
  // ADR-0027, *Amendment (#137)*: the projection's coordinator is the one caller.
  readonly runLast: Run
  /**
   * Calls `hook` at the end of every tick, with the tick's seconds, after every run's step and sink and
   * the continuations of the runs that settled in it, and again after each of its Late rounds, until the
   * `Scope` closes. Hooks run in the order they were added. A plain call, typed like a `Sink`, so a hook
   * that returns an Effect doesn't compile. A hook doesn't throw: one that does fails the tick, and with
   * it every run on the loop.
   */
  // ADR-0033: the flush gate's flush. The tick's dt: ADR-0027 *Amendment (#673)*, for the projection's
  // after-tick pass. Again after a Late round (#680), so the gate flushes what the round wrote.
  readonly afterTick: (hook: (dt: number) => undefined) => Effect.Effect<void, never, Scope.Scope>
  /**
   * Whether the **Late window** is open now: from a tick's first step until the microtask it queued at
   * its end has run. What's written then is drawn in that tick's Refresh frame, after the tick.
   */
  // ADR-0027 *Amendment (#680)* (was `ticking()`, #673): the projection's Measure pass reads it at a
  // trigger, to know it will run after its frame's tick.
  readonly inLateWindow: () => boolean
}

/** One hook on the loop's ticks, one object per `afterTick`, so removing it removes only that one. */
interface Hook {
  readonly hook: (dt: number) => undefined
}

/** One run on the loop. */
interface Entry {
  /** Its span's name, which names its defect (ADR-0040, decision 3). */
  readonly name: string
  readonly step: (dt: number) => Frame.Frame<unknown>
  readonly sink: FrameLoop.Sink<Frame.Frame<unknown>>
  readonly settles: boolean
  /** Completed by the loop: the settled Frame, the defect, or an interruption; or by its token, `Superseded` (#200). */
  readonly settled: Deferred.Deferred<Frame.Frame<unknown> | Supersede.Superseded>
  removed: boolean
  /**
   * Added in the Late window and not yet stepped (#680): a `run` run's Late step is due; a `runLast` run
   * waits for the next tick, and the dt-0 step leaves it out.
   */
  late: boolean
  /** Its span, when traced: marked `late` at its Late step (#680). */
  readonly span: Tracer.Span | undefined
}

/** How many Late rounds a window runs before the rest wait for the next tick: the Measure pass's cap (#680). */
const MAX_LATE_ROUNDS = 5

/**
 * The Frame loop's metrics: the running animations, the runs that settled and failed, and each tick's
 * ms. None unless an app gives them (`FrameLoop.layerMetrics`, #518), so an app that reads none ships and
 * updates none.
 */
export interface Metrics {
  readonly animations: Metric.Gauge<number>
  readonly settled: Metric.Counter<number>
  readonly failed: Metric.Counter<number>
  readonly tickMs: Metric.Histogram<number>
}

/**
 * Where a run's fiber finds the metrics. The loop takes them from the first run that has them: an app
 * gives them beside its Environment, which the loop's own build doesn't see, as `CheckFrames` is read.
 */
// #518, ADR-0067 *Amendment (#518)*, decision 2.
export const MetricsGiven: Context.Reference<Metrics | undefined> = Context.Reference<Metrics | undefined>("@wardic/core/FrameLoop/Metrics", {
  defaultValue: constUndefined,
})

/**
 * A check for development, off by default: on, every run started where it's on checks each Frame before
 * its sink gets it, and fails with `NonFiniteFrame` on a NaN or an Infinity. Read once a run, from the
 * caller's fiber, so an app turns it on by merging `Layer.succeed(CheckFrames, true)` beside its
 * Environment.
 */
// ADR-0030, decision 7. `FrameLoop.CheckFrames`.
export const CheckFrames: Context.Reference<boolean> = Context.Reference<boolean>("@wardic/core/FrameLoop/CheckFrames", {
  defaultValue: () => false,
})

/**
 * A Frame with a NaN or an Infinity in its `value`: the defect a checked run dies with. `key` is the key
 * that held it, `None` when the value is the number itself, and `value` is what it held.
 */
// ADR-0030, decision 7; the run's span names the run (decision 3). `FrameLoop.NonFiniteFrame`.
export class NonFiniteFrame extends Data.TaggedError("NonFiniteFrame")<{
  readonly key: Option.Option<string>
  readonly value: unknown
  readonly message: string
}> {}

/** The defect for `value` at `key`. Not the per-frame path: a run fails once. */
const nonFinite = (key: Option.Option<string>, value: unknown): NonFiniteFrame =>
  new NonFiniteFrame({
    key,
    value,
    message: Option.match(key, {
      onNone: () => `a non-finite Frame: its value is ${String(value)}`,
      onSome: (name) => `a non-finite Frame: ${name} is ${String(value)}`,
    }),
  })

/** A number that isn't finite, or a string that holds one: written out, "NaN" or "Infinity". */
const isNonFinite: Predicate.Predicate<unknown> = (value) => {
  if (Predicate.isNumber(value)) return !Number.isFinite(value)
  if (Predicate.isString(value)) return value.includes("NaN") || value.includes("Infinity")
  return false
}

/**
 * Throw `NonFiniteFrame` if a Frame's `value`, or one of a record's values, isn't finite. Per
 * frame with the check on (ADR-0025): statement `if`s, and a loop over the record's keys.
 */
const checkValue = (value: unknown): void => {
  if (isNonFinite(value)) throw nonFinite(Option.none(), value)
  if (!Predicate.isObject(value)) return
  for (const key in value) {
    if (isNonFinite(value[key])) throw nonFinite(Option.some(key), value[key])
  }
}

/** `sink`, each Frame checked first: a run's sink with `CheckFrames` on. */
const checked =
  <F extends Frame.Frame<unknown>>(sink: FrameLoop.Sink<F>): FrameLoop.Sink<F> =>
  (frame) => {
    checkValue(frame.value)
    return sink(frame)
  }

/** A run's wait for its end. Built once (#460). */
const settledOf = (entry: Entry): Effect.Effect<Frame.Frame<unknown> | Supersede.Superseded> => Deferred.await(entry.settled)

/**
 * A run's defect, named after its run: annotated with a stack frame of the run's span name and no
 * call site, so `Cause.pretty` prints `at <name>` (ADR-0030 decision 3, ADR-0040 decision 3). The
 * frame its span would have pushed, done here, only when a run dies.
 */
const dieNamed = (name: string, defect: unknown): Exit.Exit<never> =>
  Exit.failCause(Cause.annotate(Cause.die(defect), Context.make(Cause.StackTrace, { name, stack: constUndefined, parent: undefined })))

/** How the runs still on the loop end when a burst ends with them: interrupted, or failed with its cause. */
const endingOf = (exit: Exit.Exit<void>): Exit.Exit<never> =>
  Exit.match(exit, {
    // Only a Clock whose ticks end (a finite test Clock) ends a burst with runs left.
    onSuccess: () => Exit.interrupt(),
    onFailure: (cause) =>
      Bool.match(Cause.hasInterruptsOnly(cause), {
        onTrue: () => Exit.interrupt(),
        onFalse: () => Exit.failCause(cause),
      }),
  })

/** Adds `run` to `token`'s runs: read-only to the token's users, added to here, emptied by `Supersede.end` (#618, F1). */
const joinSupersede = (token: Supersede.Supersede, run: Supersede.Run): void => {
  const runs = token.runs as Array<Supersede.Run>
  runs.push(run)
}

/**
 * Build the Frame loop over the Environment's `Clock`. Needs a `Scope` (the burst's
 * `FiberHandle` lives in it), so the `FrameLoop` module wraps it as its `layer`. Its span
 * captures no call-site stack (ADR-0040, decision 2), so not `Effect.fn`, which always does:
 * `Effect.fnUntraced`, the span its pipeable (#460, Q6).
 */
export const make = Effect.fnUntraced(
  function* () {
    const clock = yield* Clock.Clock
    // The burst runs here, under the Layer's build context, never in a caller's.
    const buildContext = yield* Effect.context<Clock.Clock | Scope.Scope>()
    const burst = yield* FiberHandle.make<void>()
    const entries: Array<Entry> = []
    // The runs `runLast` added, stepped after `entries` in each tick.
    const lastEntries: Array<Entry> = []
    // The `afterTick` hooks, replaced (never changed in place) by an add or a removal, so the end
    // of a tick calls the hooks there were when it began calling them, whatever a hook adds or
    // removes.
    let hooks: ReadonlyArray<Hook> = []
    // Whether a burst holds the loop's subscription. A run's continuation runs inline while the
    // ending burst is still in `burst`, so the loop tracks its burst itself rather than asking the
    // handle (#81).
    let bursting = false
    // The Late window (ADR-0027 *Amendment (#680)*): open from a tick's first step until the microtask
    // queued at its end has run. `windowQueued` keeps one microtask per window, however many ticks open
    // it before a checkpoint (a test firing frames back to back).
    let windowOpen = false
    let windowQueued = false
    // The dt of the tick that opened the window: a Late step's.
    let windowDt = 0
    // The `run` runs added in the window, in add order: their Late step is due. The `runLast` runs added
    // in it take none, and are marked only so the dt-0 step leaves them out: they step at the next tick.
    const lateFirst: Array<Entry> = []
    const lateLast: Array<Entry> = []
    // A hook that threw in a Late round: the burst it interrupts ends every run with it (#680, Q15).
    let lateFailure: Cause.Cause<never> | undefined
    // The runs the loop ended since it last counted (#542): a settle or a failure, into the counters
    // once per tick. An interruption is neither, nor a superseded run, which the loop doesn't end.
    let settledCount = 0
    let failedCount = 0
    // The metrics, once a run brings them (#518).
    let metrics: Metrics | undefined

    /** End `entry`'s run: removed, counted, and its fiber resumed with `exit` (inline, within the tick). */
    const end = (entry: Entry, exit: Exit.Exit<Frame.Frame<unknown>>): void => {
      entry.removed = true
      if (Exit.isSuccess(exit)) settledCount++
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) failedCount++
      Deferred.doneUnsafe(entry.settled, exit)
    }

    /** The runs ended since the last count, into the counters: once per tick, and as a burst ends. */
    const countEnds = (): undefined => {
      if (Predicate.isNotUndefined(metrics)) {
        if (settledCount > 0) metrics.settled.updateUnsafe(settledCount, buildContext)
        if (failedCount > 0) metrics.failed.updateUnsafe(failedCount, buildContext)
      }
      settledCount = 0
      failedCount = 0
      return undefined
    }
    // The loop's own hook, the first: the counts reach the counters at the end of every tick, and
    // `tick`, the per-frame path, is as it was (#542).
    hooks = [{ hook: countEnds }]

    // Per frame (ADR-0025): plain calls only, in the one `Stream.map` call per tick (ADR-0027,
    // decision 8); counted loops, statement `if`s, a `try` per entry (it costs nothing measurable).

    /**
     * Step the last lane's first `count` entries, in add order, as `tick` steps the others. Per frame,
     * and only while it holds a run.
     */
    const stepLast = (count: number, dt: number): void => {
      for (let i = 0; i < count; i++) {
        const entry = lastEntries[i]
        if (entry.removed) continue
        try {
          const frame = entry.step(dt)
          entry.sink(frame)
          if (entry.settles && frame.done) end(entry, Exit.succeed(frame))
        } catch (defect) {
          end(entry, dieNamed(entry.name, defect))
        }
      }
    }

    /** Drop the last lane's removed entries in place, keeping order; how many are left. Per frame. */
    const compactLast = (): number => {
      let kept = 0
      for (let i = 0; i < lastEntries.length; i++) {
        const entry = lastEntries[i]
        if (entry.removed) continue
        lastEntries[kept] = entry
        kept++
      }
      lastEntries.length = kept
      return kept
    }

    // The first lane's loops stay inline in `tick`: moved into a function shared with the last lane,
    // Node's `chase/loop` ran 55% slower (`bench:core`, ADR-0027 *Amendment (#137)*).
    const tick = (dt: number): boolean => {
      // A window this tick finds open is the last frame's, its checkpoint not yet run (back-to-back
      // frames in a test): its runs are on the lanes, so this tick steps them.
      if (lateFirst.length + lateLast.length > 0) dropLate()
      windowOpen = true
      windowDt = dt
      // The tick's start, read only for the metrics' histogram (#518).
      let t0 = 0
      if (Predicate.isNotUndefined(metrics)) t0 = performance.now()
      // Both counts before any step: a run added during the tick isn't stepped by it. A `run` run takes its
      // Late step at the window's end, a `runLast` run waits for the next tick (#680).
      const count = entries.length
      const lastCount = lastEntries.length
      for (let i = 0; i < count; i++) {
        const entry = entries[i]
        if (entry.removed) continue
        try {
          const frame = entry.step(dt)
          entry.sink(frame)
          if (entry.settles && frame.done) end(entry, Exit.succeed(frame))
        } catch (defect) {
          end(entry, dieNamed(entry.name, defect))
        }
      }
      // The last lane, after every other run (ADR-0027, *Amendment (#137)*).
      if (lastCount > 0) stepLast(lastCount, dt)
      // Drop the removed entries in place, keeping order (and those added during the pass).
      let kept = 0
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.removed) continue
        entries[kept] = entry
        kept++
      }
      entries.length = kept
      if (lastEntries.length > 0) kept += compactLast()
      if (Predicate.isNotUndefined(metrics)) {
        metrics.animations.updateUnsafe(kept, buildContext)
        metrics.tickMs.updateUnsafe(performance.now() - t0, buildContext)
      }
      // The end of the tick: everything for this Refresh frame is written (ADR-0033). After
      // `tickMs`, which stays the cost of the steps alone.
      const ended = hooks
      for (let i = 0; i < ended.length; i++) ended[i].hook(dt)
      // The window stays open to the end of this frame's microtasks, which take the Late steps (#680).
      if (!windowQueued) {
        windowQueued = true
        queueMicrotask(endLateWindow)
      }
      // The burst ends with no run left, counted after the hooks: one a hook started (the flush
      // gate's, running a binding's batch, #209) takes its Late step and starts the next burst.
      return entries.length + lastEntries.length === 0
    }

    /** Clear the Late lists: each run on them steps at the next tick. */
    const dropLate = (): void => {
      for (let i = 0; i < lateFirst.length; i++) lateFirst[i].late = false
      for (let i = 0; i < lateLast.length; i++) lateLast[i].late = false
      lateFirst.length = 0
      lateLast.length = 0
    }

    /** Drop `list`'s first `count` entries in place, keeping the rest's order. */
    const dropFirst = (list: Array<Entry>, count: number): void => {
      const left = list.length - count
      for (let i = 0; i < left; i++) list[i] = list[i + count]
      list.length = left
    }

    /** One step of `entry` at `dt`: its Frame to its sink, its settle, or its defect, as a tick's. */
    const stepOne = (entry: Entry, dt: number): void => {
      try {
        const frame = entry.step(dt)
        entry.sink(frame)
        if (entry.settles && frame.done) end(entry, Exit.succeed(frame))
      } catch (defect) {
        end(entry, dieNamed(entry.name, defect))
      }
    }

    /** `entry`'s Late step, at the last tick's dt, its span marked. */
    const lateStep = (entry: Entry): boolean => {
      entry.late = false
      if (entry.removed) return false
      if (Predicate.isNotUndefined(entry.span)) entry.span.attribute("late", true)
      stepOne(entry, windowDt)
      return true
    }

    /**
     * One Late round: the first lane's due runs, then, when one of them stepped, the last lane's runs the
     * tick stepped again at dt 0, so they read what it wrote (#137's reads, Q9), then every hook. What the
     * round adds is the next round's.
     */
    const lateRound = (): void => {
      const firstCount = lateFirst.length
      let stepped = 0
      for (let i = 0; i < firstCount; i++) if (lateStep(lateFirst[i])) stepped++
      if (stepped > 0) {
        const count = lastEntries.length
        for (let i = 0; i < count; i++) {
          const entry = lastEntries[i]
          if (entry.removed || entry.late) continue
          stepOne(entry, 0)
        }
      }
      dropFirst(lateFirst, firstCount)
      const again = hooks
      for (let i = 0; i < again.length; i++) again[i].hook(windowDt)
    }

    /**
     * The Late window's end, the microtask its tick queued: the Late rounds, then the window closes. A run
     * left past the cap steps at the next tick. A hook that throws ends every run, as in a tick (Q15).
     */
    const endLateWindow = (): void => {
      windowQueued = false
      if (!windowOpen) return
      let rounds = 0
      try {
        while (lateFirst.length > 0 && rounds < MAX_LATE_ROUNDS) {
          rounds++
          lateRound()
        }
      } catch (defect) {
        failLate(defect)
        return
      }
      // Past the cap, the first lane's rest step at the next tick; the last lane's were never due.
      if (lateFirst.length + lateLast.length > 0) dropLate()
      windowOpen = false
    }

    /**
     * A hook threw in a Late round, outside the burst's stream: the burst is interrupted, and its end
     * fails every run with the defect, as a hook that throws in a tick fails it (#680, Q15).
     */
    const failLate = (defect: unknown): void => {
      lateFailure = Cause.die(defect)
      const fiber = burstFiber()
      if (Predicate.isNotUndefined(fiber)) {
        fiber.interruptUnsafe()
        return
      }
      endAll(Exit.void)
    }

    /** The burst's fiber, if one holds the subscription. */
    const burstFiber = (): Fiber.Fiber<void, unknown> | undefined => {
      const state = burst.state
      if (state._tag === "Closed") return undefined
      return state.fiber
    }

    const afterTick = (hook: (dt: number) => undefined): Effect.Effect<void, never, Scope.Scope> => {
      const added: Hook = { hook }
      return Effect.acquireRelease(
        Effect.sync(() => {
          hooks = Arr.append(hooks, added)
        }),
        () =>
          Effect.sync(() => {
            hooks = Arr.filter(hooks, (h) => h !== added)
          }),
      )
    }

    /**
     * A burst ended: end every run still on the loop as `endingOf` says. `bursting` clears before
     * any run resumes, so a run a continuation starts gets the next burst, inline (#81). If that
     * burst ends at once (a dead Clock), its `endAll` runs inside this one: one level deep, since
     * the runs it ends are still starting, not waiting. Not the per-frame path.
     */
    const endAll = (exit: Exit.Exit<void>): void => {
      // A Late round's hook threw (#680, Q15): this burst was interrupted for it, and its runs end with it.
      const failure = lateFailure
      lateFailure = undefined
      const ending = UndefinedOr.match(failure, { onUndefined: () => endingOf(exit), onDefined: (cause) => Exit.failCause(cause) })
      const failed = Bool.or(Exit.isFailure(exit), Predicate.isNotUndefined(failure))
      bursting = false
      // A burst that failed closes the window: no later call is in it (#673, TK3; #680). One that ran out
      // of runs leaves it open, so a run started after its last tick, in its frame, takes its Late step.
      if (failed) {
        windowOpen = false
        dropLate()
      }
      Arr.forEach(Arr.appendAll(entries.splice(0), lastEntries.splice(0)), (entry) => {
        if (!entry.removed) end(entry, ending)
      })
      if (Predicate.isNotUndefined(metrics)) metrics.animations.updateUnsafe(0, buildContext)
      countEnds()
    }

    const ticking: Effect.Effect<void> = clock.ticks.pipe(
      Stream.map(tick),
      Stream.takeUntil(identity),
      Stream.runDrain,
      Effect.onExit((exit) => Effect.sync(() => endAll(exit))),
      (self) => traced(self, "wardic.frameloop", { root: true }),
      Effect.provideContext(buildContext),
    )

    /**
     * Start a burst unless one holds the subscription, inline: no scheduler hop before the
     * subscription. While a burst ends its runs, the new one replaces it in `burst` (#81).
     */
    const startBurst: Effect.Effect<unknown> = Effect.suspend(() =>
      Bool.match(bursting, {
        onTrue: () => Effect.void,
        onFalse: () => {
          bursting = true
          return FiberHandle.run(burst, ticking)
        },
      }),
    )

    /**
     * A run added to `lane`: `run`'s and `runLast`'s one body. Its span is the `ParentSpan` of what
     * runs inside it, with no stack frame (ADR-0040, decision 3), opened only when a tracer is
     * installed (ADR-0040, *Amendment (#460)*): an app's, the devtools', a test's. Effect's default
     * records a span nothing reads, a leg's largest cost after its machine.
     */
    const runIn = (lane: Array<Entry>, late: Array<Entry>): Run =>
      (<F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>, options?: RunOptions) =>
        Effect.withFiber((fiber) => {
          // Its start log only when a Debug log would be kept (#542): Effect's own rule, read once.
          const logged = !LogLevel.isGreaterThan(fiber.getRef(References.MinimumLogLevel), "Debug")
          // The metrics from the first run whose fiber has them (#518); none is read once they're in.
          if (Predicate.isUndefined(metrics)) metrics = fiber.getRef(MetricsGiven)
          // Its span, the app's to give (#746): none without `Spans.layer`, and no closure for it.
          const spans = fiber.getRef(SpansGiven)
          if (spans === none) return added(lane, late, machine, sink, options, undefined, logged)
          return spans.run(fiber, machine.span.name, machine.span.attributes, (span) => added(lane, late, machine, sink, options, span, logged))
        })) as Run

    /**
     * The run itself: its start log when `logged`, then its entry on `lane` (and in its token, given
     * one) until it ends. A superseded end marks `span`.
     */
    const added = <F extends Frame.Frame<unknown>>(
      lane: Array<Entry>,
      late: Array<Entry>,
      machine: Machine.Machine<F>,
      sink: FrameLoop.Sink<F>,
      options: RunOptions | undefined,
      span: Tracer.Span | undefined,
      logged: boolean,
    ): Effect.Effect<F | Supersede.Superseded> => {
      // Per run, a leg each (#460, compose once): Effect's calls data-first, the steps statements.
      const run = Effect.acquireUseRelease(
        // `CheckFrames` from the caller's fiber, once per run: with it off, the sink as it is.
        Effect.flatMap(Effect.service(CheckFrames), (check) => entered(lane, late, machine, sink, options, check, span)),
        settledOf as (entry: Entry) => Effect.Effect<F | Supersede.Superseded>,
        (entry, exit) =>
          Effect.sync(() => {
            entry.removed = true
            if (Predicate.isUndefined(span)) return
            if (Exit.isSuccess(exit) && Supersede.isSuperseded(exit.value)) span.attribute("superseded", true)
          }),
      )
      // The start log stays (ADR-0040), annotated with the run's attributes, when it would be kept.
      if (!logged) return run
      return Effect.annotateLogs(Effect.andThen(Effect.logDebug(`${machine.span.name}: start`), run), machine.span.attributes)
    }

    /**
     * A run's entry on `lane` (and in its token, given one), and the burst started for it. Added in the
     * Late window, it's on `late` too: its Late step is due (#680).
     */
    const entered = <F extends Frame.Frame<unknown>>(
      lane: Array<Entry>,
      late: Array<Entry>,
      machine: Machine.Machine<F>,
      sink: FrameLoop.Sink<F>,
      options: RunOptions | undefined,
      check: boolean,
      span: Tracer.Span | undefined,
    ): Effect.Effect<Entry> => {
      // A closed Environment takes no runs: nothing would tick them.
      if (burst.state._tag === "Closed") return Effect.interrupt
      let checkedSink: FrameLoop.Sink<F> = sink
      if (check) checkedSink = checked(sink)
      const entry: Entry = {
        name: machine.span.name,
        step: machine.start(),
        sink: checkedSink as FrameLoop.Sink<Frame.Frame<unknown>>,
        settles: machine.settles,
        settled: Deferred.makeUnsafe<Frame.Frame<unknown> | Supersede.Superseded>(),
        removed: false,
        late: windowOpen,
        span,
      }
      lane.push(entry)
      if (entry.late) late.push(entry)
      if (Predicate.isNotUndefined(options)) joinSupersede(options.supersede, entry)
      return Effect.as(startBurst, entry)
    }

    const inLateWindow = (): boolean => windowOpen

    return { run: runIn(entries, lateFirst), runLast: runIn(lastEntries, lateLast), afterTick, inLateWindow } satisfies Shape
  },
  (self) => traced(self, "wardic.frameloop.make"),
)
