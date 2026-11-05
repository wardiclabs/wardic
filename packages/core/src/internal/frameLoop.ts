/**
 * The **Frame loop**'s implementation (ADR-0027), behind the `FrameLoop` module's service and
 * `layer` (ADR-0028, decision 11): one fiber per burst that steps every running
 * Primitive's machine once per tick, in one pass, and hands each its Frame. Each animation used
 * to be a fiber running its own `Stream`; at 1,000 elements that machinery was about 90% of a
 * Primitive's per-frame cost.
 *
 * - **A run** is `run(machine, sink)`: an entry added, its Frames handed to `sink` from the loop's
 *   next tick, and its settled Frame returned. `acquireUseRelease` removes the entry on every
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
 *   waits for the next tick, and one removed during it gets no Frame. It steps them in add
 *   order, those added with `runLast` after all the others (ADR-0027, *Amendment (#137)*). A step or sink that
 *   throws ends only its own run (`Exit.die`); a failure of the loop itself fails every run
 *   still on it, and the next run starts a fresh burst. That includes a run a continuation
 *   starts while the ending burst resumes its runs (#81).
 * - **The end of a tick** calls each `afterTick` hook, after every step and sink and the
 *   continuations of the runs that settled in it, the tick that ends a burst included. The flush
 *   gate flushes there, so a value paints in the Refresh frame that computed it (ADR-0033). A run
 *   a hook starts keeps the burst: whether it ends is counted after the hooks (#209).
 *
 * Observability: a span per run, named after its Primitive (`machine.span`), and one per burst
 * (`wardic.frameloop`). A run's `<name>: start` debug log, annotated with its span's attributes,
 * built only when a Debug log would be kept (#542). Per tick, no span or log: a gauge of running
 * animations and a histogram of ms per tick, each one `updateUnsafe` (ADR-0027, decision 6), and the
 * runs that settled or failed in it, counted as they end and added at its end by the loop's own
 * `afterTick` hook, its first (#542). The histogram ends before the hooks, so it measures the steps
 * alone, not the gate's flush (ADR-0033).
 *
 * A run's span is opened without a stack frame (ADR-0040, decision 3): `useSpan` with the span as
 * the `ParentSpan`, not `withSpan`, whose frame Effect stamps on an interrupted run's cause and
 * hashes in every finalizer it passes. So the loop names a run's defect itself, with a frame of
 * the run's name (ADR-0030, decision 3). No span here captures a call-site stack (decision 2).
 *
 * The dev check for non-finite Frames (`CheckFrames`, ADR-0030 decision 7) is a sink wrapper a
 * run gets at its start when the check is on, so the tick is the same either way.
 *
 * Internal (ADR-0028, decision 11): the service's shape (`run`, `afterTick`) and `make`, behind
 * `FrameLoop.layer`.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberHandle from "effect/FiberHandle"
import { constUndefined, identity } from "effect/Function"
import * as LogLevel from "effect/LogLevel"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as References from "effect/References"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as Clock from "../Clock.ts"
import type * as Frame from "../Frame.ts"
import * as Supersede from "../Supersede.ts"
import type * as FrameLoop from "../FrameLoop.ts"
import type * as Machine from "../Machine.ts"
import { isTraced, traced } from "./tracing.ts"

// @wardic/core compiles against ES2022 alone, which does not declare `performance` (see
// refresh-frame-clock.ts). It is a host global in every Environment Wardic targets.
declare const performance: { readonly now: () => number }

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
   * settles. Succeeds with the settled Frame; a machine that never settles, `chase`, runs until it's
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
   */
  // ADR-0027, *Amendment (#137)*: the projection's coordinator is the one caller.
  readonly runLast: Run
  /**
   * Calls `hook` at the end of every tick, after every run's step and sink and the continuations of the
   * runs that settled in it, until the `Scope` closes. Hooks run in the order they were added. A plain
   * call, typed like a `Sink`, so a hook that returns an Effect doesn't compile. A hook doesn't throw:
   * one that does fails the tick, and with it every run on the loop.
   */
  // ADR-0033: the flush gate is the one caller.
  readonly afterTick: (hook: () => undefined) => Effect.Effect<void, never, Scope.Scope>
}

/** One hook on the loop's ticks, one object per `afterTick`, so removing it removes only that one. */
interface Hook {
  readonly hook: () => undefined
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
}

const animations = Metric.gauge("wardic_frameloop_animations", { description: "Primitives running on the Frame loop" })
const settledRuns = Metric.counter("wardic_frameloop_settled", { description: "Runs on the Frame loop that settled" })
const failedRuns = Metric.counter("wardic_frameloop_failed", { description: "Runs on the Frame loop that failed" })
const tickMs = Metric.histogram("wardic_frameloop_tick_ms", {
  description: "Milliseconds the Frame loop spends on one tick",
  boundaries: Metric.linearBoundaries({ start: 0, width: 0.5, count: 32 }),
})

/**
 * A check for development, off by default: on, every run started where it's on checks each Frame before
 * its sink gets it, and fails with `NonFiniteFrame` on a NaN or an Infinity. Read once a run, from the
 * caller's fiber, so an app turns it on by merging `Layer.succeed(CheckFrames, true)` beside its
 * Environment.
 */
// ADR-0030, decision 7. `FrameLoop.CheckFrames`.
export const CheckFrames: Context.Reference<boolean> = Context.Reference<boolean>("@wardic/FrameLoop/CheckFrames", {
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
    // The runs the loop ended since it last counted (#542): a settle or a failure, into the counters
    // once per tick. An interruption is neither, nor a superseded run, which the loop doesn't end.
    let settledCount = 0
    let failedCount = 0

    /** End `entry`'s run: removed, counted, and its fiber resumed with `exit` (inline, within the tick). */
    const end = (entry: Entry, exit: Exit.Exit<Frame.Frame<unknown>>): void => {
      entry.removed = true
      if (Exit.isSuccess(exit)) settledCount++
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) failedCount++
      Deferred.doneUnsafe(entry.settled, exit)
    }

    /** The runs ended since the last count, into the counters: once per tick, and as a burst ends. */
    const countEnds = (): undefined => {
      if (settledCount > 0) settledRuns.updateUnsafe(settledCount, buildContext)
      if (failedCount > 0) failedRuns.updateUnsafe(failedCount, buildContext)
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
      const t0 = performance.now()
      // Both counts before any step: a run added during the tick, to either lane, waits for the next.
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
      animations.updateUnsafe(kept, buildContext)
      tickMs.updateUnsafe(performance.now() - t0, buildContext)
      // The end of the tick: everything for this Refresh frame is written (ADR-0033). After
      // `tickMs`, which stays the cost of the steps alone.
      const ended = hooks
      for (let i = 0; i < ended.length; i++) ended[i].hook()
      // The burst ends with no run left, counted after the hooks: one a hook started (the flush
      // gate's, running a binding's batch, #209) takes its first step at the next tick.
      return entries.length + lastEntries.length === 0
    }

    const afterTick = (hook: () => undefined): Effect.Effect<void, never, Scope.Scope> => {
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
      const ending = endingOf(exit)
      bursting = false
      Arr.forEach(Arr.appendAll(entries.splice(0), lastEntries.splice(0)), (entry) => {
        if (!entry.removed) end(entry, ending)
      })
      animations.updateUnsafe(0, buildContext)
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
    const runIn = (lane: Array<Entry>): Run =>
      (<F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>, options?: RunOptions) =>
        Effect.withFiber((fiber) => {
          // Its start log only when a Debug log would be kept (#542): Effect's own rule, read once.
          const logged = !LogLevel.isGreaterThan(fiber.getRef(References.MinimumLogLevel), "Debug")
          if (!isTraced(fiber)) return added(lane, machine, sink, options, undefined, logged)
          return Effect.useSpan(machine.span.name, { attributes: machine.span.attributes }, (span) =>
            Effect.provideService(added(lane, machine, sink, options, span, logged), Tracer.ParentSpan, span))
        })) as Run

    /**
     * The run itself: its start log when `logged`, then its entry on `lane` (and in its token, given
     * one) until it ends. A superseded end marks `span`.
     */
    const added = <F extends Frame.Frame<unknown>>(
      lane: Array<Entry>,
      machine: Machine.Machine<F>,
      sink: FrameLoop.Sink<F>,
      options: RunOptions | undefined,
      span: Tracer.Span | undefined,
      logged: boolean,
    ): Effect.Effect<F | Supersede.Superseded> => {
      // Per run, a leg each (#460, compose once): Effect's calls data-first, the steps statements.
      const run = Effect.acquireUseRelease(
        // `CheckFrames` from the caller's fiber, once per run: with it off, the sink as it is.
        Effect.flatMap(Effect.service(CheckFrames), (check) => entered(lane, machine, sink, options, check)),
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

    /** A run's entry on `lane` (and in its token, given one), and the burst started for it. */
    const entered = <F extends Frame.Frame<unknown>>(
      lane: Array<Entry>,
      machine: Machine.Machine<F>,
      sink: FrameLoop.Sink<F>,
      options: RunOptions | undefined,
      check: boolean,
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
      }
      lane.push(entry)
      if (Predicate.isNotUndefined(options)) options.supersede.runs.push(entry)
      return Effect.as(startBurst, entry)
    }

    return { run: runIn(entries), runLast: runIn(lastEntries), afterTick } satisfies Shape
  },
  (self) => traced(self, "wardic.frameloop.make"),
)
