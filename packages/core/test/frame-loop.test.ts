import * as Clock from "@wardic/core/Clock"
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import * as Supersede from "@wardic/core/Supersede"
import type * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
// The Frame loop's shape and `make` are internal (ADR-0028, decision 11): core's own tests reach them by path.
import * as internal from "../src/internal/frameLoop.ts"
import { describe, expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as References from "effect/References"
import { MixedScheduler } from "effect/Scheduler"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"

// The Frame loop (ADR-0027) against a hand-driven Refresh frame source and core's real Clock.
// Every fiber runs on Effect's browser fallback scheduler (`setTimeout(0)`) with its dispatches
// counted, as the Clock's own tests do: so these see real-browser timing, and a scheduler hop on
// the loop's path shows up as a dispatch.

/** A Refresh frame source the test fires by hand. */
const makeFrames = () => {
  const pending = new Map<number, (t: number) => void>()
  let nextHandle = 1
  const source: RefreshFrameSource.Shape<number> = {
    requestFrame: (callback) => {
      const handle = nextHandle++
      pending.set(handle, callback)
      return handle
    },
    cancelFrame: (handle) => {
      pending.delete(handle)
    },
  }
  /** Fire every outstanding Refresh frame at timestamp `t` (ms). */
  const fire = (t: number): void => {
    const callbacks = [...pending.values()]
    pending.clear()
    for (const callback of callbacks) callback(t)
  }
  return { source, pending, fire }
}

type ClockShape = Context.Service.Shape<typeof Clock.Clock>

/** A recording tracer: every span it makes. */
const makeTracer = () => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  return { spans, tracer }
}

/** The Clock and the Frame loop over a fresh frame source, on a counting `setTimeout(0)` scheduler. */
const makeHarness = async (options?: { readonly clock?: ClockShape }) => {
  const frames = makeFrames()
  let dispatches = 0
  const scheduler = new MixedScheduler("async", (task) => {
    dispatches++
    const timer = setTimeout(task, 0)
    return () => clearTimeout(timer)
  })
  const { spans, tracer } = makeTracer()
  const scope = Scope.makeUnsafe()
  const clock: ClockShape =
    options?.clock ??
    (await Effect.runPromise(
      Clock.fromRefreshFrames(frames.source).pipe(
        Scope.provide(scope),
      ),
      { scheduler },
    ))
  const loop: internal.Shape = await Effect.runPromise(
    internal.make().pipe(
      Effect.provideService(Clock.Clock, clock),
      Effect.provideService(Tracer.Tracer, tracer),
      Scope.provide(scope),
    ),
    { scheduler },
  )
  /** Run `effect` in a fresh fiber, inline, on the counting scheduler and the recording tracer. */
  const fork = <A, E>(effect: Effect.Effect<A, E>): Fiber.Fiber<A, E> =>
    Effect.runFork(effect.pipe(Effect.provideService(Tracer.Tracer, tracer)), { scheduler })
  /** Start `machine` on the loop in a fresh fiber, inline, with `run` (or `via`); its Frames land in `frames`. */
  const start = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, onFrame?: (frame: F) => void, via: "run" | "runLast" = "run") => {
    const received: Array<F> = []
    const fiber = fork(
      loop[via](machine, (frame) => {
        received.push(frame)
        onFrame?.(frame)
        return undefined
      }),
    )
    return { received, fiber }
  }
  /** `start`, in the last lane (ADR-0027, *Amendment (#137)*). */
  const startLast = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, onFrame?: (frame: F) => void) => start(machine, onFrame, "runLast")
  const interrupt = (fiber: Fiber.Fiber<unknown, unknown>): void => {
    Effect.runFork(Fiber.interrupt(fiber), { scheduler })
  }
  /** Close the Environment's Scope (the Clock's and the loop's), starting inline. */
  const close = (): Promise<void> => Effect.runPromise(Scope.close(scope, Exit.void), { scheduler })
  return { frames, loop, fork, start, startLast, interrupt, close, spans, dispatches: () => dispatches }
}

/** A sink that drops each Frame. */
const ignore = (): undefined => undefined

/** A sink that records each Frame in `received`. */
const into =
  <F>(received: Array<F>): FrameLoop.Sink<F> =>
  (frame) => {
    received.push(frame)
    return undefined
  }

/**
 * A Clock whose ticks are `dts`, then hold until the test ends them (`end`) or fails them
 * (`die`). Each subscription gets `dts` again and a hold of its own. So a burst can end while its
 * runs are already waiting on it, where `scriptedClock`'s ends inside the first run's start.
 */
const heldClock = (dts: ReadonlyArray<number>) => {
  let subscriptions = 0
  const holds: Array<(effect: Effect.Effect<void>) => void> = []
  const hold = Stream.drain(
    Stream.fromEffect(
      Effect.callback<void>((resume) => {
        holds.push(resume)
      }),
    ),
  )
  const shape: ClockShape = {
    ticks: Stream.suspend(() => {
      subscriptions++
      return Stream.concat(Stream.fromIterable(dts), hold)
    }),
    tick: () => Effect.void,
    now: () => 0,
  }
  return {
    shape,
    /** How many times the ticks were subscribed to: one per burst. */
    subscriptions: () => subscriptions,
    /** End the latest subscription's ticks. */
    end: () => holds.at(-1)?.(Effect.void),
    /** Fail the latest subscription's ticks with `defect`. */
    die: (defect: unknown) => holds.at(-1)?.(Effect.die(defect)),
  }
}

/** The end of the current task: one microtask checkpoint later. */
const endOfTask = (): Promise<void> => Promise.resolve()
/** A later task: every `setTimeout(0)` queued before it has run. */
const nextTimeout = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A machine whose Frames carry each dt it was stepped with; it settles after `steps` (never, if `Infinity`). */
const counting = (steps: number, name = "test.counting"): Machine.Machine<Frame.Frame<ReadonlyArray<number>>> =>
  Machine.make({
    settles: true,
    span: { name, attributes: { steps } },
    start: () => {
      const dts: Array<number> = []
      return (dt) => {
        dts.push(dt)
        return { value: [...dts], done: dts.length >= steps }
      }
    },
  })

/** A machine whose step throws on its `n`-th call. */
const throwing = (n: number): Machine.Machine<Frame.Frame<number>> =>
  Machine.make({
    settles: true,
    span: { name: "test.throwing", attributes: {} },
    start: () => {
      let calls = 0
      return () => {
        calls++
        if (calls === n) throw new Error("step threw")
        return { value: calls, done: false }
      }
    },
  })

const dtsOf = (frames: ReadonlyArray<Frame.Frame<ReadonlyArray<number>>>) => frames.at(-1)?.value ?? []

/** A `counting` machine's run, as `start` returns it. */
interface CountingRun {
  readonly received: Array<Frame.Frame<ReadonlyArray<number>>>
  readonly fiber: Fiber.Fiber<Frame.Frame<ReadonlyArray<number>>>
}

describe("the Frame loop: timing (ADR-0027, decision 5)", () => {
  it("a run started in a task is first stepped at the first Refresh frame, with the nominal dt, then at each one, with no dispatch", async () => {
    const h = await makeHarness()
    const runs = Array.from({ length: 50 }, () => h.start(counting(Infinity)))
    await endOfTask()
    // No Priming tick (ADR-0033): nothing before the first Refresh frame, which is requested.
    expect(runs.every((r) => r.received.length === 0)).toBe(true)
    expect(h.frames.pending.size).toBe(1)
    // Every run is stepped inside the Refresh frame callback: synchronously, in `fire`.
    h.frames.fire(1000)
    expect(runs.every((r) => r.received.length === 1 && r.received[0]!.value[0] === Clock.NOMINAL_DT)).toBe(true)
    h.frames.fire(1016)
    expect(runs.every((r) => r.received.length === 2)).toBe(true)
    expect(h.dispatches()).toBe(0)
  })

  it("an add during a tick (from a sink) waits for the next tick", async () => {
    const h = await makeHarness()
    let late: CountingRun | undefined
    h.start(counting(Infinity), (frame) => {
      if (frame.value.length === 1) late = h.start(counting(Infinity))
    })
    await endOfTask()
    h.frames.fire(1000)
    expect(late?.received.length).toBe(0)
    h.frames.fire(1016)
    expect(late?.received.length).toBe(1)
    expect(late?.received[0]?.value[0]).toBeCloseTo(0.016, 6)
  })

  it("a run removed during a tick, before its turn, gets no Frame", async () => {
    const h = await makeHarness()
    let removed: CountingRun | undefined
    h.start(counting(Infinity), (frame) => {
      if (frame.value.length === 2 && removed !== undefined) h.interrupt(removed.fiber)
    })
    removed = h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    expect(removed.received.length).toBe(1)
    h.frames.fire(1016)
    expect(removed.received.length).toBe(1)
    await nextTimeout()
    const exit = removed.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
  })

  it("settle: the done Frame reaches the sink, then the run completes, both inside the tick", async () => {
    const h = await makeHarness()
    const events: Array<string> = []
    const run = h.start(counting(3), (frame) => {
      events.push(`frame ${frame.value.length}${Bool.match(frame.done, { onTrue: () => " done", onFalse: () => "" })}`)
    })
    run.fiber.addObserver(() => events.push("completed"))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    h.frames.fire(1032)
    expect(events).toEqual(["frame 1", "frame 2", "frame 3 done", "completed"])
    const exit = run.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isSuccess(exit) && exit.value.done).toBe(true)
  })

  it("runs step in the order they were added", async () => {
    const h = await makeHarness()
    const order: Array<string> = []
    for (const name of ["a", "b", "c"]) h.start(counting(Infinity), () => order.push(name))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    expect(order).toEqual(["a", "b", "c", "a", "b", "c"])
  })

  it("a Retarget (a removal, then an add, in one call) stays warm: no Priming tick, one frame request", async () => {
    const h = await makeHarness()
    const first = h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    h.interrupt(first.fiber)
    const next = h.start(counting(Infinity))
    await endOfTask()
    expect(next.received.length).toBe(0)
    expect(h.frames.pending.size).toBe(1)
    h.frames.fire(1032)
    expect(dtsOf(next.received)).toEqual([0.016])
  })

  it("with nothing left, the loop drops its subscription and the Clock idles at its next Refresh frame", async () => {
    const h = await makeHarness()
    h.start(counting(2))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016) // the run settles here; the burst ends with it
    expect(h.frames.pending.size).toBe(1)
    h.frames.fire(1032) // the Clock finds no subscriber and stops
    expect(h.frames.pending.size).toBe(0)
  })
})

describe("the Frame loop: the last lane (ADR-0027, *Amendment (#137)*)", () => {
  it("a run added with runLast steps after every run `run` added, whichever was added first", async () => {
    const h = await makeHarness()
    const order: Array<string> = []
    h.startLast(counting(Infinity), () => order.push("last 1"))
    for (const name of ["a", "b"]) h.start(counting(Infinity), () => order.push(name))
    h.startLast(counting(Infinity), () => order.push("last 2"))
    h.start(counting(Infinity), () => order.push("c"))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    expect(order).toEqual(["a", "b", "c", "last 1", "last 2", "a", "b", "c", "last 1", "last 2"])
  })

  it("a sink in the last lane sees what the other sinks wrote in the same tick", async () => {
    const h = await makeHarness()
    let written = 0
    const read: Array<number> = []
    h.startLast(counting(Infinity), () => {
      read.push(written)
    })
    h.start(counting(Infinity), (frame) => {
      written = frame.value.length
    })
    await endOfTask()
    for (const t of [1000, 1016, 1032]) h.frames.fire(t)
    expect(read).toEqual([1, 2, 3])
  })

  it("an add to either lane during a tick waits for the next tick", async () => {
    const h = await makeHarness()
    let toLast: CountingRun | undefined
    let toFirst: CountingRun | undefined
    h.start(counting(Infinity), (frame) => {
      if (frame.value.length === 1) toLast = h.startLast(counting(Infinity))
    })
    h.startLast(counting(Infinity), (frame) => {
      if (frame.value.length === 1) toFirst = h.start(counting(Infinity))
    })
    await endOfTask()
    h.frames.fire(1000)
    expect([toLast?.received.length, toFirst?.received.length]).toEqual([0, 0])
    h.frames.fire(1016)
    expect([toLast?.received.length, toFirst?.received.length]).toEqual([1, 1])
  })

  it("a burst goes on while a last-lane run is left, and ends with it", async () => {
    const h = await makeHarness()
    const first = h.start(counting(1))
    const last = h.startLast(counting(3))
    await endOfTask()
    h.frames.fire(1000) // the first settles
    expect(h.frames.pending.size).toBe(1)
    h.frames.fire(1016)
    h.frames.fire(1032) // the last settles; the burst ends with it
    expect([first.received.length, last.received.length]).toEqual([1, 3])
    expect(h.frames.pending.size).toBe(1)
    h.frames.fire(1048) // the Clock finds no subscriber and stops
    expect(h.frames.pending.size).toBe(0)
  })

  it("a Clock whose ticks end interrupts the last lane's runs too", async () => {
    const clock = heldClock([0.016])
    const h = await makeHarness({ clock: clock.shape })
    const first = h.start(counting(Infinity))
    const last = h.startLast(counting(Infinity))
    await nextTimeout()
    clock.end()
    await nextTimeout()
    for (const run of [first, last]) {
      const exit = run.fiber.pollUnsafe()
      expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
    }
  })
})

describe("the Frame loop: failure isolation (ADR-0027, decision 7)", () => {
  it("a step that throws fails only its own run", async () => {
    const h = await makeHarness()
    const failing = h.start(throwing(2))
    const healthy = h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    h.frames.fire(1032)
    expect(healthy.received.length).toBe(3)
    const exit = failing.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })

  it("a sink that throws fails only its own run", async () => {
    const h = await makeHarness()
    const failing = h.start(counting(Infinity), (frame) => {
      if (frame.value.length === 2) throw new Error("sink threw")
    })
    const healthy = h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    h.frames.fire(1032)
    expect(healthy.received.length).toBe(3)
    const exit = failing.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })

  /** A Clock whose ticks are `dts`, then whatever `end` is. */
  const scriptedClock = (dts: ReadonlyArray<number>, end: Stream.Stream<number>): ClockShape => ({
    ticks: Stream.concat(Stream.fromIterable(dts), end),
    tick: () => Effect.void,
    now: () => 0,
  })

  it("a failure in the loop itself fails every run on it, and the next run starts a fresh burst", async () => {
    const h = await makeHarness({ clock: scriptedClock([0.01], Stream.die(new Error("ticks broke"))) })
    const a = h.start(counting(Infinity))
    const exitA = a.fiber.pollUnsafe()
    expect(exitA !== undefined && Exit.isFailure(exitA) && Cause.hasDies(exitA.cause)).toBe(true)
    expect(a.received.length).toBe(1)
    const b = h.start(counting(Infinity))
    expect(b.received.length).toBe(1) // a fresh burst, a fresh subscription
  })

  it("a Clock whose ticks end interrupts every run still on the loop", async () => {
    const h = await makeHarness({ clock: scriptedClock([0.01, 0.01], Stream.empty) })
    const run = h.start(counting(5))
    expect(run.received.length).toBe(2)
    const exit = run.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
  })

  // A run's continuation runs inline while the ending burst still holds the loop's subscription
  // (#81): the run it starts gets the next burst at once, inline.
  it("a run started from a failed run's catchCause, as the Clock dies, gets Frames from a fresh burst", async () => {
    const clock = heldClock([0.01])
    const h = await makeHarness({ clock: clock.shape })
    const retried: Array<Frame.Frame<ReadonlyArray<number>>> = []
    const fiber = h.fork(
      h.loop
        .run(counting(Infinity), ignore)
        .pipe(Effect.catchCause(() => h.loop.run(counting(1), into(retried)))),
    )
    clock.die(new Error("ticks broke"))
    expect(clock.subscriptions()).toBe(2)
    expect(dtsOf(retried)).toEqual([0.01])
    const exit = fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isSuccess(exit) && exit.value.done).toBe(true)
    expect(h.dispatches()).toBe(0)
  })

  it("a run started from an interrupted run's ensuring, as the Clock's ticks end, gets Frames from a fresh burst", async () => {
    const clock = heldClock([0.01])
    const h = await makeHarness({ clock: clock.shape })
    const after: Array<Frame.Frame<ReadonlyArray<number>>> = []
    const fiber = h.fork(
      h.loop
        .run(counting(Infinity), ignore)
        .pipe(Effect.ensuring(Effect.asVoid(h.loop.run(counting(1), into(after))))),
    )
    clock.end()
    expect(clock.subscriptions()).toBe(2)
    expect(dtsOf(after)).toEqual([0.01])
    const exit = fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
  })

  // Each retry's burst dies inside the last one's `endAll`: one level deep, not one per retry.
  // Each retry yields once, a hop on the harness's `setTimeout(0)` scheduler, which Node clamps to
  // 1 ms: 2,000 retries take about 2.5 s alone, and past the default 5 s under a full parallel run.
  it("a run retrying against a Clock that dies at once gets a fresh burst on each retry, and ends", async () => {
    const held = heldClock([0.01])
    let subscriptions = 0
    const clock: ClockShape = {
      ...held.shape,
      ticks: Stream.suspend(() => {
        subscriptions++
        if (subscriptions === 1) return held.shape.ticks
        return Stream.concat(Stream.make(0.01), Stream.die(new Error("still dead")))
      }),
    }
    const h = await makeHarness({ clock })
    const fiber = h.fork(
      h.loop
        .run(counting(Infinity), ignore)
        .pipe(
          Effect.catchCause(() =>
            Effect.retry(Effect.sandbox(h.loop.run(counting(Infinity), ignore)), { times: 2000 }),
          ),
        ),
    )
    held.die(new Error("ticks broke"))
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(subscriptions).toBe(2002)
    expect(Exit.isFailure(exit)).toBe(true)
  }, 20000)

  it("closing the Environment interrupts every run on the loop, and a run started after it is interrupted at once", async () => {
    const h = await makeHarness()
    const runs = [h.start(counting(Infinity)), h.start(counting(Infinity))]
    await endOfTask()
    h.frames.fire(1000)
    await h.close()
    for (const run of runs) {
      const exit = run.fiber.pollUnsafe()
      expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
    }
    const late = h.start(counting(Infinity))
    const exit = late.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
    expect(late.received.length).toBe(0)
  })
})

describe("the Frame loop: spans and metrics (ADR-0027, decisions 3 and 6)", () => {
  it("one span per run, named after its machine and ended at its settle or interruption; one root span per burst", async () => {
    const h = await makeHarness()
    const settles = h.start(counting(2, "test.settles"))
    const interrupted = h.start(counting(Infinity, "test.interrupted"))
    await endOfTask()
    h.frames.fire(1000)
    h.interrupt(interrupted.fiber)
    await endOfTask()
    h.frames.fire(1016)
    const byName = (name: string) => h.spans.filter((span) => span.name === name)
    const [settledSpan] = byName("test.settles")
    expect(settledSpan?.attributes.get("steps")).toBe(2)
    expect(settledSpan?.status._tag === "Ended" && Exit.isSuccess(settledSpan.status.exit)).toBe(true)
    const [interruptedSpan] = byName("test.interrupted")
    expect(interruptedSpan?.status._tag === "Ended" && Exit.hasInterrupts(interruptedSpan.status.exit)).toBe(true)
    const bursts = byName("wardic.frameloop")
    expect(bursts.length).toBe(1)
    expect(Option.isNone(bursts[0]!.parent)).toBe(true)
    expect(bursts[0]!.status._tag).toBe("Ended")
    expect(settles.fiber.pollUnsafe()).toBeDefined()
  })

  // ADR-0040, decision 3: a run's span is opened without a stack frame, and the loop names a
  // run's defect itself.
  it("SF1: a run's span is parented to the caller's span, and is the current span inside the run: its start log lands on it", async () => {
    const h = await makeHarness()
    h.fork(
      Effect.withSpan(h.loop.run(counting(1, "test.child"), ignore), "app.caller", { captureStackTrace: false }).pipe(
        // Debug, and only the logger that makes each log an event on the current span.
        Effect.provideService(References.MinimumLogLevel, "Debug"),
        Effect.provideService(References.CurrentLoggers, new Set([Logger.tracerLogger])),
      ),
    )
    await endOfTask()
    h.frames.fire(1000)
    const [caller] = h.spans.filter((span) => span.name === "app.caller")
    const [child] = h.spans.filter((span) => span.name === "test.child")
    expect(Option.map(child!.parent, (parent) => parent.spanId)).toEqual(Option.some(caller!.spanId))
    expect(child!.status._tag).toBe("Ended")
    expect(child!.events.map((event) => event[0])).toContain("test.child: start")
  })

  it("SF2: an interrupted run's cause carries no stack frame: its span pushes none, so no finalizer hashes one", async () => {
    const h = await makeHarness()
    const run = h.start(counting(Infinity, "test.interrupted"))
    await endOfTask()
    h.frames.fire(1000)
    h.interrupt(run.fiber)
    await endOfTask()
    const exit = run.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
    if (exit === undefined || Exit.isSuccess(exit)) return
    expect(Context.getOrUndefined(Cause.annotations(exit.cause), Cause.StackTrace)).toBeUndefined()
  })

  it("SF3: a run's defect is named after its run, with no call site, in either lane: it pretty-prints `at <run>` and no location", async () => {
    const h = await makeHarness()
    const first = h.start(throwing(1))
    const last = h.startLast(throwing(1))
    await endOfTask()
    h.frames.fire(1000)
    await endOfTask()
    for (const run of [first, last]) {
      const exit = run.fiber.pollUnsafe()
      expect(exit !== undefined && Exit.isFailure(exit)).toBe(true)
      if (exit === undefined || Exit.isSuccess(exit)) return
      const lines = Cause.pretty(exit.cause).split("\n").map((line) => line.trim())
      expect(lines).toContain("at test.throwing")
      expect(lines.some((line) => line.startsWith("at test.throwing ("))).toBe(false)
    }
  })

  it("counts settles and failures", async () => {
    const counts = () =>
      Effect.runSync(Metric.snapshot).reduce<Record<string, unknown>>((out, snapshot) => {
        out[snapshot.id] = snapshot.state
        return out
      }, {})
    const countOf = (state: unknown): number => Number((state as { readonly count?: number } | undefined)?.count ?? 0)
    const before = counts()
    const h = await makeHarness()
    h.start(counting(1))
    h.start(throwing(1))
    await endOfTask()
    h.frames.fire(1000)
    const after = counts()
    expect(countOf(after["wardic_frameloop_settled"]) - countOf(before["wardic_frameloop_settled"])).toBe(1)
    expect(countOf(after["wardic_frameloop_failed"]) - countOf(before["wardic_frameloop_failed"])).toBe(1)
  })

  /** A metric's state now, by its id. */
  const stateOf = <S>(id: string): S | undefined =>
    Effect.runSync(Metric.snapshot).find((snapshot) => snapshot.id === id)?.state as S | undefined

  it("the gauge holds each tick's running animations, and 0 once a burst ends with runs on it", async () => {
    const gauge = () => stateOf<Metric.GaugeState<number>>("wardic_frameloop_animations")?.value
    const h = await makeHarness()
    const runs = [h.start(counting(Infinity)), h.start(counting(Infinity)), h.start(counting(Infinity))]
    await endOfTask()
    h.frames.fire(1000)
    expect(gauge()).toBe(3)
    h.interrupt(runs[0]!.fiber)
    h.frames.fire(1016)
    expect(gauge()).toBe(2)
    await h.close()
    expect(gauge()).toBe(0)
  })

  it("the histogram records each tick's ms", async () => {
    const ticks = () => stateOf<Metric.HistogramState>("wardic_frameloop_tick_ms")?.count ?? 0
    const before = ticks()
    const h = await makeHarness()
    h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    expect(ticks() - before).toBe(2)
  })
})

describe("the Frame loop: afterTick (ADR-0033)", () => {
  /** Add `hook` to `h`'s loop in a fresh Scope, inline; closing the Scope removes it. */
  const addHook = (h: Awaited<ReturnType<typeof makeHarness>>, hook: () => undefined): Scope.Closeable => {
    const scope = Scope.makeUnsafe()
    Effect.runSync(h.loop.afterTick(hook).pipe(Scope.provide(scope)))
    return scope
  }

  it("a hook runs at the end of every tick, after every sink and a settled run's continuation, the tick that ends the burst included", async () => {
    const h = await makeHarness()
    const events: Array<string> = []
    addHook(h, () => {
      events.push("hook")
      return undefined
    })
    const a = h.start(counting(1), () => events.push("a"))
    a.fiber.addObserver(() => events.push("a settled"))
    const b = h.start(counting(2), () => events.push("b"))
    b.fiber.addObserver(() => events.push("b settled"))
    await endOfTask()
    expect(events).toEqual([])
    h.frames.fire(1000)
    expect(events).toEqual(["a", "a settled", "b", "hook"])
    h.frames.fire(1016) // b settles: the last run, so this tick ends the burst
    expect(events).toEqual(["a", "a settled", "b", "hook", "b", "b settled", "hook"])
    h.frames.fire(1032) // the Clock idles: no tick, no hook
    expect(events).toHaveLength(7)
  })

  it("hooks run in the order they were added, each until its Scope closes; an idle loop calls none", async () => {
    const h = await makeHarness()
    const events: Array<string> = []
    const first = addHook(h, () => {
      events.push("first")
      return undefined
    })
    addHook(h, () => {
      events.push("second")
      return undefined
    })
    await endOfTask()
    expect(h.frames.pending.size).toBe(0) // no run, no burst, no tick
    h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    expect(events).toEqual(["first", "second"])
    Effect.runSync(Scope.close(first, Exit.void))
    h.frames.fire(1016)
    expect(events).toEqual(["first", "second", "second"])
  })

  it("a run a hook starts in the tick that ends the burst steps at the next tick and settles (#209)", async () => {
    // The flush gate's hook runs a binding's batch, which can start a Retarget: Solid 2 runs its
    // pending effects there. The burst used to end with the tick's own runs, interrupting it.
    const h = await makeHarness()
    let started: ReturnType<typeof h.start> | undefined
    let settled = false
    addHook(h, () => {
      if (started === undefined && settled) started = h.start(counting(2))
      return undefined
    })
    h.start(counting(1), (frame) => {
      settled = frame.done
    })
    await endOfTask()
    h.frames.fire(1000) // a settles: the tick's last run, and the hook starts another
    expect(started).toBeDefined()
    expect(started!.fiber.pollUnsafe()).toBeUndefined()
    h.frames.fire(1016)
    h.frames.fire(1032)
    expect(started!.received.map((frame) => frame.done)).toEqual([false, true])
    const exit = started!.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isSuccess(exit)).toBe(true)
  })

  it("a hook that throws fails the tick: every run on the loop fails with the defect", async () => {
    const h = await makeHarness()
    let throws = true
    addHook(h, () => {
      if (throws) {
        throws = false
        throw new Error("hook threw")
      }
      return undefined
    })
    const runs = [h.start(counting(Infinity)), h.start(counting(Infinity))]
    await endOfTask()
    h.frames.fire(1000)
    for (const run of runs) {
      const exit = run.fiber.pollUnsafe()
      expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    }
  })
})

describe("the Frame loop: superseded runs (#200, ADR-0027 *Amendment (#200)*)", () => {
  /** `machine` on the loop, given `token`: its Frames land in `received`. */
  const startWith = <F extends Frame.Frame<unknown>>(h: Awaited<ReturnType<typeof makeHarness>>, machine: Machine.Machine<F>, token: Supersede.Supersede, onFrame?: (frame: F) => void) => {
    const received: Array<F> = []
    const fiber = h.fork(
      h.loop.run(
        machine,
        (frame) => {
          received.push(frame)
          onFrame?.(frame)
          return undefined
        },
        { supersede: token },
      ),
    )
    return { received, fiber }
  }

  it("SU1: Supersede.end ends each run before it returns: its fiber has succeeded with Superseded, with no dispatch and no interrupt", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    const runs = Array.from({ length: 20 }, () => startWith(h, counting(Infinity), token))
    await endOfTask()
    h.frames.fire(1000)
    const before = h.dispatches()
    Supersede.end(token)
    for (const { fiber } of runs) {
      const exit = fiber.pollUnsafe()
      expect(exit !== undefined && Exit.isSuccess(exit) && Supersede.isSuperseded(exit.value)).toBe(true)
      expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(false)
    }
    expect(h.dispatches() - before).toBe(0)
  })

  it("SU2: a superseded run leaves the loop at once: no further step or Frame, even when it's ended mid-tick before its turn", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    const steady = startWith(h, counting(Infinity), token)
    // Another run's sink ends the token on the second tick, before the superseded run's turn.
    const other = Supersede.make()
    startWith(h, counting(Infinity), other, (frame) => {
      if (frame.value.length === 2) Supersede.end(token)
    })
    const later = startWith(h, counting(Infinity), token)
    await endOfTask()
    h.frames.fire(1000)
    expect([steady.received.length, later.received.length]).toEqual([1, 1])
    h.frames.fire(1016)
    // `steady` was stepped before the sink ended the token; `later`, after it, gets no Frame.
    expect([steady.received.length, later.received.length]).toEqual([2, 1])
    h.frames.fire(1033)
    expect([steady.received.length, later.received.length]).toEqual([2, 1])
  })

  it("SU3: a superseded run's span ends OK, marked superseded: true", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    startWith(h, counting(Infinity, "test.superseded"), token)
    await endOfTask()
    h.frames.fire(1000)
    Supersede.end(token)
    const span = h.spans.find((s) => s.name === "test.superseded")
    expect(span?.status._tag).toBe("Ended")
    expect(span?.status._tag === "Ended" && Exit.isSuccess(span.status.exit)).toBe(true)
    expect(span?.attributes.get("superseded")).toBe(true)
  })

  it("SU4: a run without the token, or with another, is untouched by its end", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    const mine = startWith(h, counting(Infinity), token)
    const theirs = startWith(h, counting(Infinity), Supersede.make())
    const plain = h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    Supersede.end(token)
    h.frames.fire(1016)
    expect([mine.received.length, theirs.received.length, plain.received.length]).toEqual([1, 2, 2])
    expect(theirs.fiber.pollUnsafe()).toBeUndefined()
    expect(plain.fiber.pollUnsafe()).toBeUndefined()
  })

  it("SU5: end twice is harmless; a run given the token after an end joins it, and the next end ends it", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    const first = startWith(h, counting(Infinity), token)
    await endOfTask()
    Supersede.end(token)
    Supersede.end(token)
    expect(token.runs).toEqual([])
    const second = startWith(h, counting(Infinity), token)
    await endOfTask()
    h.frames.fire(1000)
    expect(second.received.length).toBe(1)
    Supersede.end(token)
    const exits = [first.fiber.pollUnsafe(), second.fiber.pollUnsafe()]
    expect(exits.every((exit) => exit !== undefined && Exit.isSuccess(exit) && Supersede.isSuperseded(exit.value))).toBe(true)
  })

  it("SU6: a run superseded before its first tick gets no Frame, and ends Superseded", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    const run = startWith(h, counting(Infinity), token)
    Supersede.end(token)
    await endOfTask()
    h.frames.fire(1000)
    expect(run.received.length).toBe(0)
    const exit = run.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isSuccess(exit) && Supersede.isSuperseded(exit.value)).toBe(true)
  })

  it("SU7: a run that settled first keeps its settled Frame; a superseded one counts as neither a settle nor a failure", async () => {
    const counts = () =>
      Effect.runSync(Metric.snapshot).reduce<Record<string, unknown>>((out, snapshot) => {
        out[snapshot.id] = snapshot.state
        return out
      }, {})
    const countOf = (state: unknown): number => Number((state as { readonly count?: number } | undefined)?.count ?? 0)
    const before = counts()
    const h = await makeHarness()
    const token = Supersede.make()
    const settles = startWith(h, counting(1), token)
    const runs = startWith(h, counting(Infinity), token)
    await endOfTask()
    h.frames.fire(1000)
    Supersede.end(token)
    const settled = settles.fiber.pollUnsafe()
    expect(settled !== undefined && Exit.isSuccess(settled) && !Supersede.isSuperseded(settled.value)).toBe(true)
    expect(runs.fiber.pollUnsafe() !== undefined).toBe(true)
    const after = counts()
    expect(countOf(after["wardic_frameloop_settled"]) - countOf(before["wardic_frameloop_settled"])).toBe(1)
    expect(countOf(after["wardic_frameloop_failed"]) - countOf(before["wardic_frameloop_failed"])).toBe(0)
  })
})
