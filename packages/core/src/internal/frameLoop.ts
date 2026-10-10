/**
 * The **Frame loop**'s implementation (ADR-0027), behind the `FrameLoop` module's service and
 * `layer` (ADR-0028, decision 11): one fiber per burst that steps every running
 * Primitive's machine once per tick, in one pass, and hands each its Frame. Each animation used
 * to be a fiber running its own `Stream`; at 1,000 elements that machinery was about 90% of a
 * Primitive's per-frame cost.
 *
 * - **A run** is `run(machine, sink)`: an entry added, its Frames handed to `sink` from the loop's
 *   next tick, and its settled Frame returned. `acquireUseRelease` removes the entry on every
 *   exit (a settle, an interruption, a defect), so interrupting a run removes it at once.
 * - **A burst** is the loop's one `Clock.ticks` subscription, held in a `FiberHandle` and forked
 *   under the Layer's build context (never a caller's scheduler or span, the Clock's own rule,
 *   ADR-0017). The first run starts it; it ends itself at the first tick with nothing left, so
 *   a Retarget (a removal, then an add, in one call) keeps it, and the Clock goes idle at its
 *   next Refresh frame. The Layer's `Scope` closing interrupts it.
 * - **A tick** steps the entries the tick began with: an entry added during it (from a sink)
 *   waits for the next tick, and one removed during it gets no Frame. A step or sink that
 *   throws ends only its own run (`Exit.die`); a failure of the loop itself fails every run
 *   still on it, and the next run starts a fresh burst. That includes a run a continuation
 *   starts while the ending burst resumes its runs (#81).
 *
 * Observability: a span per run, named after its Primitive (`machine.span`), and one per burst
 * (`wardic.frameloop`). Per tick, no span or log: a gauge of running animations and a histogram
 * of ms per tick, each one `updateUnsafe` (ADR-0027, decision 6).
 *
 * Internal (ADR-0028, decision 11): the service's shape and `make`, behind `FrameLoop.layer`.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberHandle from "effect/FiberHandle"
import { identity } from "effect/Function"
import * as Match from "effect/Match"
import * as Metric from "effect/Metric"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Clock from "../Clock.ts"
import type * as Frame from "../Frame.ts"
import type * as FrameLoop from "../FrameLoop.ts"
import type * as Machine from "../Machine.ts"

// @wardic/core compiles against ES2022 alone, which does not declare `performance` (see
// refresh-frame-clock.ts). It is a host global in every Environment Wardic targets.
declare const performance: { readonly now: () => number }

/** The Frame loop's service shape. */
export interface Shape {
  /**
   * Run `machine` on the loop, handing each of its Frames to `sink`, from the loop's next tick
   * until it settles. Succeeds with the settled Frame (a machine that never settles, `chase`,
   * runs until interrupted); dies with the defect if its step or its sink throws. Interrupting
   * it removes it at once. One span per run, named after its Primitive.
   */
  readonly run: <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>) => Effect.Effect<F>
}

/** One run on the loop. */
interface Entry {
  readonly step: (dt: number) => Frame.Frame<unknown>
  readonly sink: FrameLoop.Sink<Frame.Frame<unknown>>
  readonly settles: boolean
  /** Completed by the loop: the settled Frame, the defect, or an interruption. */
  readonly settled: Deferred.Deferred<Frame.Frame<unknown>>
  removed: boolean
}

const animations = Metric.gauge("wardic_frameloop_animations", { description: "Primitives running on the Frame loop" })
const settledRuns = Metric.counter("wardic_frameloop_settled", { description: "Runs on the Frame loop that settled" })
const failedRuns = Metric.counter("wardic_frameloop_failed", { description: "Runs on the Frame loop that failed" })
const tickMs = Metric.histogram("wardic_frameloop_tick_ms", {
  description: "Milliseconds the Frame loop spends on one tick",
  boundaries: Metric.linearBoundaries({ start: 0, width: 0.5, count: 32 }),
})

/** A run's ending, counted: a settle or a failure (an interruption is neither). */
const countEnd = (exit: Exit.Exit<unknown>): Effect.Effect<void> =>
  Exit.match(exit, {
    onSuccess: () => Metric.update(settledRuns, 1),
    onFailure: (cause) =>
      Bool.match(Cause.hasInterruptsOnly(cause), {
        onTrue: () => Effect.void,
        onFalse: () => Metric.update(failedRuns, 1),
      }),
  })

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
 * `FiberHandle` lives in it), so the `FrameLoop` module wraps it as its `layer`.
 */
export const make = Effect.fn("wardic.frameloop.make")(function* () {
  const clock = yield* Clock.Clock
  // The burst runs here, under the Layer's build context, never in a caller's.
  const buildContext = yield* Effect.context<Clock.Clock | Scope.Scope>()
  const burst = yield* FiberHandle.make<void>()
  const entries: Array<Entry> = []
  // Whether a burst holds the loop's subscription. A run's continuation runs inline while the
  // ending burst is still in `burst`, so the loop tracks its burst itself rather than asking the
  // handle (#81).
  let bursting = false

  /** End `entry`'s run: removed, and its fiber resumed with `exit` (inline, within the tick). */
  const end = (entry: Entry, exit: Exit.Exit<Frame.Frame<unknown>>): void => {
    entry.removed = true
    Deferred.doneUnsafe(entry.settled, exit)
  }

  // Per frame (ADR-0025): plain calls only, in the one `Stream.map` call per tick (ADR-0027,
  // decision 8); counted loops, statement `if`s, a `try` per entry (it costs nothing measurable).
  const tick = (dt: number): boolean => {
    const t0 = performance.now()
    const count = entries.length
    for (let i = 0; i < count; i++) {
      const entry = Arr.getUnsafe(entries, i)
      if (entry.removed) continue
      try {
        const frame = entry.step(dt)
        entry.sink(frame)
        if (entry.settles && frame.done) end(entry, Exit.succeed(frame))
      } catch (defect) {
        end(entry, Exit.die(defect))
      }
    }
    // Drop the removed entries in place, keeping order (and those added during the pass).
    let kept = 0
    for (let i = 0; i < entries.length; i++) {
      const entry = Arr.getUnsafe(entries, i)
      if (entry.removed) continue
      entries[kept] = entry
      kept++
    }
    entries.length = kept
    animations.updateUnsafe(kept, buildContext)
    tickMs.updateUnsafe(performance.now() - t0, buildContext)
    return kept === 0
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
    Arr.forEach(entries.splice(0), (entry) => {
      if (!entry.removed) end(entry, ending)
    })
    animations.updateUnsafe(0, buildContext)
  }

  const ticking: Effect.Effect<void> = clock.ticks.pipe(
    Stream.map(tick),
    Stream.takeUntil(identity),
    Stream.runDrain,
    Effect.onExit((exit) => Effect.sync(() => endAll(exit))),
    Effect.withSpan("wardic.frameloop", { root: true }),
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

  const run = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>): Effect.Effect<F> =>
    Effect.logDebug(`${machine.span.name}: start`).pipe(
      Effect.andThen(
        Effect.acquireUseRelease(
          Effect.suspend(() =>
            Match.value(burst.state).pipe(
              // A closed Environment takes no runs: nothing would tick them.
              Match.tag("Closed", () => Effect.interrupt),
              Match.tag("Open", () => {
                const entry: Entry = {
                  step: machine.start(),
                  sink: sink as FrameLoop.Sink<Frame.Frame<unknown>>,
                  settles: machine.settles,
                  settled: Deferred.makeUnsafe<Frame.Frame<unknown>>(),
                  removed: false,
                }
                entries.push(entry)
                return Effect.as(startBurst, entry)
              }),
              Match.exhaustive,
            ),
          ),
          (entry) => Deferred.await(entry.settled) as Effect.Effect<F>,
          (entry, exit) =>
            Effect.sync(() => {
              entry.removed = true
            }).pipe(Effect.andThen(countEnd(exit))),
        ),
      ),
      Effect.annotateLogs(machine.span.attributes),
      Effect.withSpan(machine.span.name, { attributes: machine.span.attributes }),
    )

  return { run } satisfies Shape
})
