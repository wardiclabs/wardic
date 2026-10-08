import {
  Clock,
  type Frame,
  type FrameLoopShape,
  type Machine,
  makeFrameLoop,
  makeRefreshFrameClock,
  NOMINAL_DT,
  type RefreshFrameSource,
} from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import { MixedScheduler } from "effect/Scheduler"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import { Atom, AtomRegistry } from "effect/reactivity"

// The Frame loop (ADR-0027) against a hand-driven Refresh frame source and core's real Clock.
// Every fiber runs on Effect's browser fallback scheduler (`setTimeout(0)`) with its dispatches
// counted, as the Clock's own tests do: so these see real-browser timing, and a scheduler hop on
// the loop's path shows up as a dispatch.

/** A Refresh frame source the test fires by hand. */
const makeFrames = () => {
  const pending = new Map<number, (t: number) => void>()
  let nextHandle = 1
  const source: RefreshFrameSource<number> = {
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

type ClockShape = Context.Service.Shape<typeof Clock>

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
  const registry = AtomRegistry.make()
  const clock: ClockShape =
    options?.clock ??
    (await Effect.runPromise(
      makeRefreshFrameClock(frames.source).pipe(
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Scope.provide(scope),
      ),
      { scheduler },
    ))
  const loop: FrameLoopShape = await Effect.runPromise(
    makeFrameLoop().pipe(
      Effect.provideService(Clock, clock),
      Effect.provideService(Tracer.Tracer, tracer),
      Scope.provide(scope),
    ),
    { scheduler },
  )
  /** Start `machine` on the loop in a fresh fiber, inline; its Frames land in `frames`. */
  const start = <F extends Frame<unknown>>(machine: Machine<F>, onFrame?: (frame: F) => void) => {
    const received: Array<F> = []
    const fiber = Effect.runFork(
      loop.run(machine, (frame) => {
        received.push(frame)
        onFrame?.(frame)
        return undefined
      }).pipe(Effect.provideService(Tracer.Tracer, tracer)),
      { scheduler },
    )
    return { received, fiber }
  }
  const interrupt = (fiber: Fiber.Fiber<unknown, unknown>): void => {
    Effect.runFork(Fiber.interrupt(fiber), { scheduler })
  }
  return { frames, start, interrupt, spans, dispatches: () => dispatches }
}

/** The end of the current task: one microtask checkpoint later. */
const endOfTask = (): Promise<void> => Promise.resolve()
/** A later task: every `setTimeout(0)` queued before it has run. */
const nextTimeout = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A machine whose Frames carry each dt it was stepped with; it settles after `steps` (never, if `Infinity`). */
const counting = (steps: number, name = "test.counting"): Machine<Frame<ReadonlyArray<number>>> => ({
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
const throwing = (n: number): Machine<Frame<number>> => ({
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

const dtsOf = (frames: ReadonlyArray<Frame<ReadonlyArray<number>>>) => frames.at(-1)?.value ?? []

/** A `counting` machine's run, as `start` returns it. */
interface CountingRun {
  readonly received: Array<Frame<ReadonlyArray<number>>>
  readonly fiber: Fiber.Fiber<Frame<ReadonlyArray<number>>>
}

describe("the Frame loop: timing (ADR-0027, decision 5)", () => {
  it("a run started in a task gets the Priming tick at its end, then each Refresh frame, with no dispatch", async () => {
    const h = await makeHarness()
    const runs = Array.from({ length: 50 }, () => h.start(counting(Infinity)))
    expect(runs.every((r) => r.received.length === 0)).toBe(true)
    await endOfTask()
    expect(runs.every((r) => r.received.length === 1 && r.received[0]!.value[0] === NOMINAL_DT)).toBe(true)
    // Every run is stepped inside the Refresh frame callback: synchronously, in `fire`.
    h.frames.fire(1000)
    expect(runs.every((r) => r.received.length === 2)).toBe(true)
    h.frames.fire(1016)
    expect(runs.every((r) => r.received.length === 3)).toBe(true)
    expect(h.dispatches()).toBe(0)
  })

  it("an add during a tick (from a sink) waits for the next tick", async () => {
    const h = await makeHarness()
    let late: CountingRun | undefined
    h.start(counting(Infinity), (frame) => {
      if (frame.value.length === 2) late = h.start(counting(Infinity))
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
    expect(removed.received.length).toBe(1)
    h.frames.fire(1000)
    expect(removed.received.length).toBe(1)
    await nextTimeout()
    const exit = removed.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true)
  })

  it("settle: the done Frame reaches the sink, then the run completes, both inside the tick", async () => {
    const h = await makeHarness()
    const events: Array<string> = []
    const run = h.start(counting(3), (frame) => {
      events.push(`frame ${frame.value.length}${frame.done ? " done" : ""}`)
    })
    run.fiber.addObserver(() => events.push("completed"))
    await endOfTask()
    h.frames.fire(1000)
    h.frames.fire(1016)
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
    h.frames.fire(1000) // the run settles here; the burst ends with it
    expect(h.frames.pending.size).toBe(1)
    h.frames.fire(1016) // the Clock finds no subscriber and stops
    expect(h.frames.pending.size).toBe(0)
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
    expect(healthy.received.length).toBe(3)
    const exit = failing.fiber.pollUnsafe()
    expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })

  /** A Clock whose ticks are `dts`, then whatever `end` is. */
  const scriptedClock = (dts: ReadonlyArray<number>, end: Stream.Stream<number>): ClockShape => ({
    time: Atom.make(0),
    dt: Atom.make(0),
    ticks: Stream.concat(Stream.fromIterable(dts), end),
    tick: () => Effect.void,
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
    const after = counts()
    expect(countOf(after["wardic_frameloop_settled"]) - countOf(before["wardic_frameloop_settled"])).toBe(1)
    expect(countOf(after["wardic_frameloop_failed"]) - countOf(before["wardic_frameloop_failed"])).toBe(1)
  })
})
