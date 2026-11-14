import * as Clock from "@wardic/core/Clock"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
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
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as References from "effect/References"
import { MixedScheduler } from "effect/Scheduler"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as Spans from "../src/Spans.ts"

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

/** Wardic's spans (#746): `Spans.layer` unless `given` is `false`, then nothing. */
const spansOf = (given: boolean | undefined): Layer.Layer<never> => Bool.match(given === false, { onTrue: () => Layer.empty, onFalse: () => Spans.layer })

/**
 * The Clock and the Frame loop over a fresh frame source, on a counting `setTimeout(0)` scheduler. With
 * `metrics`, each run is given `FrameLoop.layerMetrics`, as an app gives it beside its Environment (#518).
 */
const makeHarness = async (options?: { readonly clock?: ClockShape; readonly metrics?: boolean; readonly spans?: boolean }) => {
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
      // Wardic's spans, the app's to give (#746): given unless a test asks for none.
      Effect.provide(spansOf(options?.spans)),
      Scope.provide(scope),
    ),
    { scheduler },
  )
  /** Run `effect` in a fresh fiber, inline, on the counting scheduler and the recording tracer. */
  const fork = <A, E>(effect: Effect.Effect<A, E>): Fiber.Fiber<A, E> => {
    const traced = effect.pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provide(spansOf(options?.spans)))
    if (options?.metrics === true) return Effect.runFork(traced.pipe(Effect.provide(FrameLoop.layerMetrics)), { scheduler })
    return Effect.runFork(traced, { scheduler })
  }
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
    // The frame's microtasks run before any task: the Retarget below is in a task, after the Late window.
    await endOfTask()
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

  // The loop counts its runs' ends itself (#542): a run a failing burst fails is counted as the burst ends.
  it("a failure in the loop itself counts each run it fails, once", async () => {
    const failed = () =>
      Number((Effect.runSync(Metric.snapshot).find((snapshot) => snapshot.id === "wardic_frameloop_failed")?.state as { readonly count?: number } | undefined)?.count ?? 0)
    const h = await makeHarness({ clock: scriptedClock([0.01], Stream.die(new Error("ticks broke"))), metrics: true })
    const before = failed()
    h.start(counting(Infinity))
    expect(failed() - before).toBe(1)
    h.start(counting(Infinity))
    expect(failed() - before).toBe(2)
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
  it("SP3 (#746): with a tracer but no Spans.layer, a run and its burst open no span", async () => {
    const h = await makeHarness({ spans: false })
    const settles = h.start(counting(2, "test.settles"))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    await endOfTask()
    expect(settles.fiber.pollUnsafe()).toBeDefined()
    expect(h.spans.map((span) => span.name)).toEqual([])
  })

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
    const h = await makeHarness({ metrics: true })
    h.start(counting(1))
    h.start(throwing(1))
    await endOfTask()
    h.frames.fire(1000)
    const after = counts()
    expect(countOf(after["wardic_frameloop_settled"]) - countOf(before["wardic_frameloop_settled"])).toBe(1)
    expect(countOf(after["wardic_frameloop_failed"]) - countOf(before["wardic_frameloop_failed"])).toBe(1)
  })

  // #518: the metrics are a Layer an app gives; without it the loop builds and updates none.
  it("records no metric without FrameLoop.layerMetrics", async () => {
    const ids = ["wardic_frameloop_animations", "wardic_frameloop_settled", "wardic_frameloop_failed", "wardic_frameloop_tick_ms"]
    const states = () => {
      const snapshot = Effect.runSync(Metric.snapshot)
      return ids.map((id) => JSON.stringify(snapshot.find((metric) => metric.id === id)?.state))
    }
    const before = states()
    const h = await makeHarness()
    h.start(counting(1))
    h.start(throwing(1))
    h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
    await h.close()
    expect(states()).toEqual(before)
  })

  /** A metric's state now, by its id. */
  const stateOf = <S>(id: string): S | undefined =>
    Effect.runSync(Metric.snapshot).find((snapshot) => snapshot.id === id)?.state as S | undefined

  it("the gauge holds each tick's running animations, and 0 once a burst ends with runs on it", async () => {
    const gauge = () => stateOf<Metric.GaugeState<number>>("wardic_frameloop_animations")?.value
    const h = await makeHarness({ metrics: true })
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
    const h = await makeHarness({ metrics: true })
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

describe("the Frame loop: inLateWindow() and a hook's dt (ADR-0027 *Amendments (#673, #680)*)", () => {
  /** Add `hook` to `h`'s loop in a fresh Scope, inline. */
  const addHook = (h: Awaited<ReturnType<typeof makeHarness>>, hook: (dt: number) => undefined): void => {
    Effect.runSync(h.loop.afterTick(hook).pipe(Scope.provide(Scope.makeUnsafe())))
  }

  /** A machine that records `inLateWindow()` in each step, and settles after `steps`. */
  const reading = (h: Awaited<ReturnType<typeof makeHarness>>, steps: number, seen: Array<string>): Machine.Machine<Frame.Frame<number>> =>
    Machine.make({
      settles: true,
      span: { name: "test.reading", attributes: {} },
      start: () => {
        let n = 0
        return () => {
          n++
          seen.push(`step ${h.loop.inLateWindow()}`)
          return { value: n, done: n >= steps }
        }
      },
    })

  it("TK1: inLateWindow() is true in a tick's steps, sinks and hooks and through its frame's microtasks, the tick that ends the burst included, and false after them", async () => {
    const h = await makeHarness()
    const seen: Array<string> = []
    addHook(h, () => {
      seen.push(`hook ${h.loop.inLateWindow()}`)
      return undefined
    })
    expect(h.loop.inLateWindow()).toBe(false)
    h.start(reading(h, 2, seen), () => seen.push(`sink ${h.loop.inLateWindow()}`))
    await endOfTask()
    expect(h.loop.inLateWindow(), "after the run's add, before the first Refresh frame").toBe(false)
    h.frames.fire(1000)
    expect(h.loop.inLateWindow(), "after the tick, before its microtasks").toBe(true)
    await endOfTask()
    expect(h.loop.inLateWindow(), "between frames").toBe(false)
    h.frames.fire(1016) // the run settles: this tick ends the burst
    await endOfTask()
    expect(h.loop.inLateWindow()).toBe(false)
    expect(seen).toEqual(["step true", "sink true", "hook true", "step true", "sink true", "hook true"])
  })

  it("TK2: each hook gets its tick's dt: the nominal one first, then the measured one", async () => {
    const h = await makeHarness()
    const dts: Array<number> = []
    addHook(h, (dt) => {
      dts.push(dt)
      return undefined
    })
    h.start(counting(3))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1020)
    h.frames.fire(1050)
    expect(dts).toHaveLength(3)
    expect(dts[0]).toBeCloseTo(Clock.NOMINAL_DT, 9)
    expect(dts[1]).toBeCloseTo(0.02, 9)
    expect(dts[2]).toBeCloseTo(0.03, 9)
  })

  it("TK3: a hook that throws ends its tick and closes the window: inLateWindow() is false after it, also through the next burst's gaps", async () => {
    const h = await makeHarness()
    let throws = true
    addHook(h, () => {
      if (throws) {
        throws = false
        throw new Error("hook threw")
      }
      return undefined
    })
    h.start(counting(Infinity))
    await endOfTask()
    h.frames.fire(1000) // the hook throws mid-tick: the burst fails
    expect(h.loop.inLateWindow()).toBe(false)
    const seen: Array<string> = []
    h.start(reading(h, 2, seen))
    await endOfTask()
    expect(h.loop.inLateWindow()).toBe(false)
    h.frames.fire(1016)
    await endOfTask()
    expect(h.loop.inLateWindow()).toBe(false)
    expect(seen).toEqual(["step true"])
  })
})

describe("the Frame loop: the Late window (ADR-0027 *Amendment (#680)*)", () => {
  // A browser runs a microtask checkpoint after each Refresh frame callback, before the next callback
  // and before the paint: `fire`, then `endOfTask()`, is one frame here.
  /** Fire the Refresh frame at `t`, then its callback's microtasks: one browser frame, up to its paint. */
  const frame = async (h: Awaited<ReturnType<typeof makeHarness>>, t: number): Promise<void> => {
    h.frames.fire(t)
    await endOfTask()
  }
  /** Add `hook` to `h`'s loop in a fresh Scope, inline. */
  const addHook = (h: Awaited<ReturnType<typeof makeHarness>>, hook: (dt: number) => undefined): void => {
    Effect.runSync(h.loop.afterTick(hook).pipe(Scope.provide(Scope.makeUnsafe())))
  }

  it("LW1: a run a sink adds takes a Late step in that tick's window, at the tick's dt, then its next step at the next tick", async () => {
    const h = await makeHarness()
    let late: CountingRun | undefined
    h.start(counting(Infinity), (f) => {
      if (f.value.length === 1) late = h.start(counting(Infinity))
    })
    await endOfTask()
    h.frames.fire(1000)
    expect(late?.received.length, "the Late step waits for the window's microtask").toBe(0)
    await endOfTask()
    expect(dtsOf(late!.received)).toEqual([Clock.NOMINAL_DT])
    await frame(h, 1016)
    expect(late!.received).toHaveLength(2)
    expect(dtsOf(late!.received)[1]).toBeCloseTo(0.016, 6)
  })

  it("LW2: a run a settle's continuation starts takes its Late step", async () => {
    const h = await makeHarness()
    let next: CountingRun | undefined
    const first = h.start(counting(1))
    first.fiber.addObserver(() => {
      next = h.start(counting(Infinity))
    })
    await endOfTask()
    await frame(h, 1000)
    expect(dtsOf(next!.received)).toEqual([Clock.NOMINAL_DT])
  })

  it("LW3: a run a hook starts takes its Late step, and every hook runs again after the round, with the tick's dt", async () => {
    const h = await makeHarness()
    const events: Array<string> = []
    let added: CountingRun | undefined
    addHook(h, (dt) => {
      events.push(`hook ${dt.toFixed(3)}`)
      if (Predicate.isUndefined(added)) added = h.start(counting(Infinity), () => events.push("late run"))
      return undefined
    })
    h.start(counting(Infinity), () => events.push("run"))
    await endOfTask()
    await frame(h, 1000)
    expect(events).toEqual(["run", "hook 0.017", "late run", "hook 0.017"])
    await frame(h, 1016)
    // Nothing added in that window: no Late round, so the hooks run once.
    expect(events.slice(4)).toEqual(["run", "late run", "hook 0.016"])
  })

  it("LW4: a run added in a microtask the tick queued takes its Late step; one added in a later task steps at the next tick", async () => {
    const h = await makeHarness()
    let inMicrotask: CountingRun | undefined
    let inTask: CountingRun | undefined
    h.start(counting(Infinity), (f) => {
      if (f.value.length !== 1) return
      queueMicrotask(() => {
        inMicrotask = h.start(counting(Infinity))
      })
      setTimeout(() => {
        inTask = h.start(counting(Infinity))
      }, 0)
    })
    await endOfTask()
    await frame(h, 1000)
    expect(dtsOf(inMicrotask!.received)).toEqual([Clock.NOMINAL_DT])
    expect(h.loop.inLateWindow()).toBe(false)
    await nextTimeout()
    expect(inTask!.received).toHaveLength(0)
    await frame(h, 1016)
    expect(inTask!.received).toHaveLength(1)
    expect(dtsOf(inTask!.received)[0]).toBeCloseTo(0.016, 6)
  })

  it("LW5: a round whose runs add more is followed by another, at most 5; the rest step at the next tick", async () => {
    const h = await makeHarness()
    const chain: Array<CountingRun> = []
    // Each link's first step starts the next, from its sink, up to 7 links.
    const link = (): void => {
      chain.push(
        h.start(counting(Infinity), (f) => {
          if (f.value.length === 1 && chain.length < 7) link()
        }),
      )
    }
    h.start(counting(Infinity), (f) => {
      if (f.value.length === 1) link()
    })
    await endOfTask()
    await frame(h, 1000)
    // Rounds 1-5 stepped links 1-5; link 5's step added link 6, past the cap.
    expect(chain.map((run) => run.received.length)).toEqual([1, 1, 1, 1, 1, 0])
    await frame(h, 1016)
    // The tick stepped link 6, whose sink added link 7: its Late step, in this window.
    expect(chain.map((run) => run.received.length)).toEqual([2, 2, 2, 2, 2, 1, 1])
    expect(dtsOf(chain[5]!.received)[0]).toBeCloseTo(0.016, 6)
    // A warm Late step goes at its tick's dt, as every other run stepped by.
    expect(dtsOf(chain[6]!.received)[0]).toBeCloseTo(0.016, 6)
  })

  it("LW6: a last-lane run the tick stepped steps again at dt 0 after a first-lane Late step, so it reads what that step wrote", async () => {
    const h = await makeHarness()
    const order: Array<string> = []
    const last = (name: string) => (f: Frame.Frame<ReadonlyArray<number>>) => order.push(`${name} ${f.value.at(-1)!.toFixed(3)}`)
    h.startLast(counting(Infinity), last("last"))
    h.start(counting(Infinity), (f) => {
      order.push("first")
      if (f.value.length === 1) h.start(counting(Infinity), last("lateFirst"))
    })
    await endOfTask()
    await frame(h, 1000)
    expect(order).toEqual(["first", "last 0.017", "lateFirst 0.017", "last 0.000"])
  })

  it("LW6b: a last-lane run added in the window takes no Late step, nor a dt-0 step: it first steps at the next tick", async () => {
    // The projection's coordinator would step again the nodes an after-tick Measure pass stepped (#680).
    const h = await makeHarness()
    const order: Array<string> = []
    h.startLast(counting(Infinity), (f) => order.push(`last ${f.value.at(-1)!.toFixed(3)}`))
    h.start(counting(Infinity), (f) => {
      if (f.value.length !== 1) return
      h.startLast(counting(Infinity), (g) => order.push(`lateLast ${g.value.at(-1)!.toFixed(3)}`))
      h.start(counting(Infinity))
    })
    await endOfTask()
    await frame(h, 1000)
    expect(order, "the first-lane Late step gives the tick's last-lane run its dt-0 step, not the new one").toEqual(["last 0.017", "last 0.000"])
    await frame(h, 1016)
    expect(order.slice(2)).toEqual(["last 0.016", "lateLast 0.016"])
  })

  it("LW7: inLateWindow() is true in a microtask the tick queued and false in a later task", async () => {
    const h = await makeHarness()
    const seen: Array<string> = []
    h.start(counting(Infinity), (f) => {
      if (f.value.length !== 1) return
      queueMicrotask(() => seen.push(`microtask ${h.loop.inLateWindow()}`))
      setTimeout(() => seen.push(`task ${h.loop.inLateWindow()}`), 0)
    })
    await endOfTask()
    await frame(h, 1000)
    await nextTimeout()
    expect(seen).toEqual(["microtask true", "task false"])
  })

  it("LW8: a hook that throws in a Late round ends every run with the defect and closes the window; the next run gets a fresh burst", async () => {
    const h = await makeHarness()
    let throwNext = false
    addHook(h, () => {
      if (!throwNext) return undefined
      throwNext = false
      throw new Error("late hook threw")
    })
    let late: CountingRun | undefined
    const first = h.start(counting(Infinity), (f) => {
      if (f.value.length === 1) {
        late = h.start(counting(Infinity), () => {
          throwNext = true
        })
      }
    })
    await endOfTask()
    await frame(h, 1000)
    for (const run of [first, late!]) {
      const exit = run.fiber.pollUnsafe()
      expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      expect(Cause.pretty((exit as Exit.Failure<unknown, unknown>).cause)).toContain("late hook threw")
    }
    expect(h.loop.inLateWindow()).toBe(false)
    const fresh = h.start(counting(2))
    await endOfTask()
    await frame(h, 1016)
    await frame(h, 1032)
    expect(fresh.received.map((f) => f.done)).toEqual([false, true])
  })

  it("LW9: a run added in the window after its tick ended the burst takes its Late step and starts the next burst", async () => {
    const h = await makeHarness()
    let next: CountingRun | undefined
    h.start(counting(1), () =>
      queueMicrotask(() => {
        next = h.start(counting(2))
      }),
    )
    await endOfTask()
    await frame(h, 1000) // the only run settles: this tick ends the burst
    expect(dtsOf(next!.received)).toEqual([Clock.NOMINAL_DT])
    expect(h.frames.pending.size).toBe(1)
    await frame(h, 1016)
    expect(next!.received.map((f) => f.done)).toEqual([false, true])
  })

  it("LW10: a run superseded before its Late step gets none, and ends Superseded; a round that steps none gives the last lane no dt-0 step", async () => {
    const h = await makeHarness()
    const token = Supersede.make()
    const received: Array<Frame.Frame<ReadonlyArray<number>>> = []
    const last = h.startLast(counting(Infinity))
    let late: Fiber.Fiber<unknown> | undefined
    h.start(counting(Infinity), (f) => {
      if (f.value.length !== 1) return
      late = h.fork(h.loop.run(counting(Infinity), into(received), { supersede: token }))
      Supersede.end(token)
    })
    await endOfTask()
    await frame(h, 1000)
    expect(received).toHaveLength(0)
    const exit = late!.pollUnsafe()
    expect(exit !== undefined && Exit.isSuccess(exit) && Supersede.isSuperseded(exit.value)).toBe(true)
    expect(dtsOf(last.received), "the tick's step alone").toEqual([Clock.NOMINAL_DT])
  })

  it("LW11: a run's span is marked late: true at its Late step; one stepped by a tick isn't", async () => {
    const h = await makeHarness()
    h.start(counting(Infinity, "test.ticked"), (f) => {
      if (f.value.length === 1) h.start(counting(Infinity, "test.late"))
    })
    await endOfTask()
    await frame(h, 1000)
    const spanOf = (name: string) => h.spans.find((span) => span.name === name)
    expect(spanOf("test.late")?.attributes.get("late")).toBe(true)
    expect(spanOf("test.ticked")?.attributes.has("late")).toBe(false)
  })

  it("LW12: a window the next tick finds still open (frames fired back to back) is dropped: its runs step once, in that tick", async () => {
    const h = await makeHarness()
    let late: CountingRun | undefined
    h.start(counting(Infinity), (f) => {
      if (f.value.length === 1) late = h.start(counting(Infinity))
    })
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016) // no checkpoint between: the first window's run is on the lane, and this tick steps it
    await endOfTask()
    expect(dtsOf(late!.received)).toHaveLength(1)
    expect(dtsOf(late!.received)[0]).toBeCloseTo(0.016, 6)
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
    const h = await makeHarness({ metrics: true })
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
