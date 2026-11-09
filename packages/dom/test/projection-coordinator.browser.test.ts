// The projection coordinator's lifecycle (ADR-0009, ADR-0018; #75 makes it a run on the Frame
// loop, ADR-0027). Checked against a fake ProjectionSink with Refresh frames fired by hand, on
// DomLive's own parts, composed as DomLive composes them, with the Clock wrapped to count its open
// `ticks` subscriptions, the Frame loop wrapped to record its runs, a Tracer that records every
// span, and a logger that records every log.
//
// - A coordinator that settled is started afresh by the next trigger, cold or warm.
// - One started inside a tick, after the coordinator settled earlier in that tick, is stepped from
//   the next tick.
// - Disposing the system mid-burst, a release in place and the last active node's dispose stop it:
//   no write after, and the Clock's subscription goes once nothing else runs.
// - The layout lab's reading: a Tracer merged beside the Environment sees the coordinator's span
//   and a `wardic.clock` span open while a lone FLIP runs.
// - Since #75, the coordinator is one run on the Frame loop: it settles inside its step, a stop
//   outside its step interrupts it, and a step that throws fails it alone, logged, until the next
//   trigger starts a fresh run.
import { describe, expect, it } from "@effect/vitest"
import * as Clock from "@wardic/core/Clock"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as References from "effect/References"
import { AtomRegistry } from "effect/reactivity"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import { afterEach, beforeEach, vi } from "vitest"
import * as DomClock from "@wardic/dom/DomClock"
import * as DomInput from "@wardic/dom/DomInput"
import * as DomProbe from "@wardic/dom/DomProbe"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, fireFrames, makeSink, stage, stubFrames, unstubFrames, type Write } from "./projection-harness.ts"
import * as internalProjection from "../src/internal/projection.ts"
import * as Option from "effect/Option"

type ClockShape = Context.Service.Shape<typeof Clock.Clock>
type LoopShape = Context.Service.Shape<typeof FrameLoop.FrameLoop>
type NativeSpanOptions = ConstructorParameters<typeof Tracer.NativeSpan>[0]

/** One span the Tracer saw: its attributes and how it ended, filled in at its end. */
interface SpanRecord {
  readonly name: string
  attributes: Record<string, unknown>
  exit: "open" | "Success" | "Failure" | "Interrupted"
}

/** One run on the Frame loop: its machine's span name and attributes, and how it ended. */
interface RunRecord {
  readonly name: string
  readonly attributes: Readonly<Record<string, unknown>>
  /** Which lane it was added to: `runLast` steps after every `run` (ADR-0027, *Amendment (#137)*). */
  readonly lane: "run" | "runLast"
  exit: SpanRecord["exit"]
}

/** One log the Environment's logger saw. */
interface Logged {
  readonly level: string
  readonly message: string
  readonly cause: string | undefined
}

const COORDINATOR = "wardic.projection.coordinator"

const exitTag = (exit: Exit.Exit<unknown, unknown>): SpanRecord["exit"] =>
  Exit.match(exit, {
    onSuccess: () => "Success" as const,
    onFailure: (cause) => {
      if (Cause.hasInterruptsOnly(cause)) return "Interrupted" as const
      return "Failure" as const
    },
  })

/**
 * The engine over `sink`, on DomLive's parts with its Clock counting the open subscriptions to
 * its `ticks` and the most open at once (a count of the most, not a total: a run after the loop
 * went idle opens another), and its Frame loop recording each run and the most coordinator runs
 * live at once.
 */
const makeEngine = (sink: ReturnType<typeof makeSink>["sink"]) => {
  let open = 0
  let most = 0
  const countTicks = (clock: ClockShape): ClockShape => ({
    ...clock,
    ticks: Stream.suspend(() => {
      open++
      most = Math.max(most, open)
      return clock.ticks.pipe(
        Stream.ensuring(
          Effect.sync(() => {
            open--
          }),
        ),
      )
    }),
  })
  const runs: Array<RunRecord> = []
  let coordinators = 0
  let mostCoordinators = 0
  // Both lanes recorded: the coordinator runs in the last (ADR-0027, *Amendment (#137)*).
  const recorded =
    (go: LoopShape["run"], lane: RunRecord["lane"]): LoopShape["run"] =>
    (machine, sink) =>
      Effect.suspend(() => {
        const record: RunRecord = { name: machine.span.name, attributes: machine.span.attributes, lane, exit: "open" }
        runs.push(record)
        const coordinator = record.name === COORDINATOR
        if (coordinator) mostCoordinators = Math.max(mostCoordinators, ++coordinators)
        return go(machine, sink).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              record.exit = exitTag(exit)
              if (coordinator) coordinators--
            }),
          ),
        )
      })
  const recordRuns = (loop: LoopShape): LoopShape => ({
    afterTick: loop.afterTick,
    ticking: loop.ticking,
    run: recorded(loop.run, "run"),
    runLast: recorded(loop.runLast, "runLast"),
  })
  const spans: Array<SpanRecord> = []
  const spanEnds: Array<(record: SpanRecord) => void> = []
  class RecordingSpan extends Tracer.NativeSpan {
    readonly record: SpanRecord
    constructor(options: NativeSpanOptions) {
      super(options)
      this.record = { name: options.name, attributes: {}, exit: "open" }
      spans.push(this.record)
    }
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      super.end(endTime, exit)
      this.record.attributes = Object.fromEntries(this.attributes)
      this.record.exit = exitTag(exit)
      for (const listener of spanEnds) listener(this.record)
    }
  }
  const logs: Array<Logged> = []
  // What the app's ErrorReporters would get (ADR-0030, decision 4): each reported error's message.
  const reports: Array<string> = []
  const services = Layer.mergeAll(
    Layer.effect(Clock.Clock)(Clock.Clock.useSync(countTicks)).pipe(Layer.provide(DomClock.layer)),
    DomRenderer.layer,
    DomInput.layer,
    DomProbe.layer,
    InterpolatorRegistry.layer,
  )
  const env = Layer.effect(FrameLoop.FrameLoop)(FrameLoop.FrameLoop.useSync(recordRuns)).pipe(
    Layer.provide(FrameLoop.layer),
    Layer.provideMerge(services),
    Layer.provideMerge(AtomRegistry.layer),
  )
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      env,
      Layer.succeed(Tracer.Tracer, Tracer.make({ span: (options) => new RecordingSpan(options) })),
      Logger.layer([
        Logger.map(Logger.formatStructured, (s) => {
          logs.push({ level: s.level, message: String(s.message), cause: s.cause })
        }),
      ]),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
      ErrorReporter.layer([ErrorReporter.make(({ error }) => void reports.push(error.message))]),
    ),
  )
  const system = internalProjection.makeProjectionSystem(runtime, sink)
  engines.push({ system, runtime })
  return {
    system,
    runtime,
    spans,
    logs,
    open: () => open,
    most: () => most,
    coordinatorRuns: () => runs.filter((r) => r.name === COORDINATOR),
    mostCoordinators: () => mostCoordinators,
    onSpanEnd: (listener: (record: SpanRecord) => void) => spanEnds.push(listener),
    errors: () => logs.filter((l) => l.level === "ERROR"),
    reports: (): ReadonlyArray<string> => reports,
  }
}

type Engine = ReturnType<typeof makeEngine>

const engines: Array<{ readonly system: { readonly dispose: () => void }; readonly runtime: { readonly dispose: () => Promise<void> } }> = []

beforeEach(() => {
  stubFrames()
})
afterEach(() => {
  for (const { system, runtime } of engines.splice(0)) {
    system.dispose()
    void runtime.dispose()
  }
  unstubFrames()
  clearStages()
})

/** A 50 × 50 box at `left` on a fresh stage. */
const box = (left = 0): HTMLElement => el(stage("position:relative;width:800px;height:100px"), `position:absolute;top:0;left:${left}px;width:50px;height:50px`)

/** Register `element` as node `id` and let its first Measure pass run. */
const register = async (
  e: Engine,
  id: string,
  element: HTMLElement,
  transition: () => Option.Option<ProjectionSystem.LayoutTransition> = () => Option.some({ type: "spring" }),
): Promise<ProjectionSystem.NodeHandle> => {
  const handle = e.system.register({ id, element, transition })
  await endOfTask()
  return handle
}

const offset = (w: Write): number => Math.abs(w.tx) + Math.abs(w.ty)

/** Fire Refresh frames until `id` gets no write for 5 frames in a row (at most 600). */
const settle = (sink: ReturnType<typeof makeSink>, id: string): void => {
  let quiet = 0
  for (let i = 0; i < 600 && quiet < 5; i++) {
    const before = sink.of(id).length
    fireFrame()
    if (sink.of(id).length === before) quiet++
    else quiet = 0
  }
}

/**
 * A run of the test's own on the Frame loop that never settles, handing each Frame to `onFrame`. In
 * the last lane, added after the coordinator, it steps after the coordinator in each tick (ADR-0027,
 * *Amendment (#137)*).
 */
const hold = (e: Engine, onFrame: () => void = () => {}, lane: "run" | "runLast" = "run") => {
  const machine = Machine.make<Frame.Frame<number>>({
    settles: false,
    span: { name: "test.hold", attributes: {} },
    start: () => () => ({ value: 0, done: false }),
  })
  const sink = (): undefined => {
    onFrame()
    return undefined
  }
  return e.runtime.runFork(FrameLoop.FrameLoop.use((loop) => loop[lane](machine, sink)))
}

describe("a coordinator that settled is started afresh by the next trigger", () => {
  for (const clock of ["cold", "warm"] as const) {
    it(`${clock}: the node is seeded at once, steps at the next Refresh frame, then settles on its slot`, async () => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      if (clock === "warm") hold(e)
      const element = box(0)
      const a = await register(e, "a", element)
      fireFrame()

      element.style.left = "200px"
      a.notify()
      await endOfTask()
      settle(sk, "a")
      expect(offset(sk.of("a").at(-1)!), "the first FLIP ends on its slot").toBeLessThan(0.5)
      fireFrames(2)
      if (clock === "cold") expect(e.open(), "the Clock is idle").toBe(0)

      const before = sk.of("a").length
      element.style.left = "0px"
      a.notify()
      await endOfTask()
      // No Priming step (ADR-0033): the seed alone before the frame, the first step at it.
      expect(sk.of("a").slice(before).length, "the seed alone").toBe(1)
      fireFrame()
      const since = sk.of("a").slice(before)
      expect(since.length, "the seed, then the first Refresh frame's step").toBe(2)
      expect(Math.abs(since[0]!.tx - 200), "the seed paints the origin").toBeLessThan(0.5)
      expect(offset(since[1]!), "the first step moved it").toBeLessThan(offset(since[0]!))
      settle(sk, "a")
      expect(offset(sk.of("a").at(-1)!), "the second FLIP ends on its slot").toBeLessThan(0.5)
      expect(e.errors()).toEqual([])
      expect(e.reports()).toEqual([])
    })
  }
})

describe("a coordinator started inside a tick, after it settled earlier in that tick", () => {
  it("steps from the next tick, and its node's release then settles", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const aEl = box(0)
    const a = await register(e, "a", aEl)
    const b = await register(e, "b", box(300))
    fireFrame()
    aEl.style.left = "200px"
    a.notify()
    await endOfTask()

    // A run of the test's own in the last lane, started after the coordinator, so the loop steps it
    // after the coordinator in each tick. Its first Frame after the coordinator's span ends grabs b.
    let frame = 0
    let settledAt = -1
    let grabbedAt = -1
    let bWritesAtGrab = 0
    e.onSpanEnd((s) => {
      if (s.name === COORDINATOR && settledAt < 0) settledAt = frame
    })
    hold(
      e,
      () => {
        if (settledAt < 0 || grabbedAt >= 0) return
        grabbedAt = frame
        b.dragStart()
        bWritesAtGrab = sk.of("b").length
      },
      "runLast",
    )
    for (let i = 0; i < 600 && grabbedAt < 0; i++) {
      frame++
      fireFrame()
    }
    expect(settledAt, "the coordinator settled").toBeGreaterThan(0)
    expect(grabbedAt, "the grab came in the tick the coordinator settled in").toBe(settledAt)
    expect(sk.of("b").length, "only the grab's own derive in that tick").toBe(bWritesAtGrab)

    // The new coordinator derives b at the next tick; held still, b draws the same, so the render gate
    // writes nothing then (#27). That it steps is the release below: only the coordinator settles it.
    frame++
    fireFrame()

    b.dragMove({ x: 60, y: 0 })
    b.dragEnd()
    await endOfTask()
    settle(sk, "b")
    expect(offset(sk.of("b").at(-1)!), "the release ends on b's slot").toBeLessThan(0.5)
    expect(e.errors()).toEqual([])
    expect(e.reports()).toEqual([])
  })
})

describe("stopping the coordinator outside a tick", () => {
  for (const beside of ["alone", "beside a run of the test's own"] as const) {
    it(`disposing the system mid-burst, ${beside}: no projection write after it, and the Clock's subscription goes with the last run`, async () => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      let held = 0
      if (beside !== "alone") hold(e, () => void held++)
      const element = box(0)
      const a = await register(e, "a", element)
      fireFrame()
      element.style.left = "200px"
      a.notify()
      await endOfTask()
      fireFrames(3)

      e.system.dispose()
      const writes = sk.writes.length
      const heldBefore = held
      fireFrames(3)
      expect(sk.writes.length, "no write after the dispose").toBe(writes)
      if (beside === "alone") {
        expect(e.open(), "nothing holds the Clock").toBe(0)
      } else {
        expect(held - heldBefore, "the other run keeps its Frames").toBe(3)
        expect(e.open(), "the other run holds the Clock").toBe(1)
      }
      expect(e.errors()).toEqual([])
      expect(e.reports()).toEqual([])
    })
  }

  it("a release in place stops it: no write after, and the Clock's subscription goes", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const b = await register(e, "b", box(0))
    fireFrame()
    b.dragStart()
    fireFrames(2)
    b.dragMove({ x: 30, y: 0 })
    fireFrame()
    b.dragMove({ x: 0, y: 0 })
    b.dragEnd()
    await endOfTask()
    const writes = sk.writes.length
    fireFrames(3)
    expect(sk.writes.length, "no write after the release").toBe(writes)
    expect(offset(sk.of("b").at(-1)!), "b at its slot").toBeLessThan(0.01)
    expect(e.open(), "nothing holds the Clock").toBe(0)
    expect(e.errors()).toEqual([])
    expect(e.reports()).toEqual([])
  })

  it("the last active node's dispose stops it: no write after, and the Clock's subscription goes", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const element = box(0)
    const a = await register(e, "a", element)
    fireFrame()
    element.style.left = "200px"
    a.notify()
    await endOfTask()
    fireFrames(3)

    a.dispose()
    const writes = sk.writes.length
    fireFrames(3)
    expect(sk.writes.length, "no write after the dispose").toBe(writes)
    expect(e.open(), "nothing holds the Clock").toBe(0)
    expect(e.errors()).toEqual([])
    expect(e.reports()).toEqual([])
  })
})

describe("the layout lab's reading of a lone FLIP", () => {
  it("a Tracer merged beside the Environment sees the coordinator's span, and a wardic.clock span open until it settles", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const element = box(0)
    const a = await register(e, "a", element)
    fireFrame()
    expect(e.spans.filter((s) => s.name === "wardic.clock" && s.exit === "open"), "the Clock is idle").toHaveLength(0)

    element.style.left = "200px"
    a.notify()
    await endOfTask()
    fireFrames(3)
    expect(e.spans.filter((s) => s.name === "wardic.clock" && s.exit === "open"), "the Clock ticks").toHaveLength(1)
    const coordinators = e.spans.filter((s) => s.name === COORDINATOR)
    expect(coordinators).toHaveLength(1)
    expect(coordinators[0]!.exit).toBe("open")

    settle(sk, "a")
    fireFrames(2)
    expect(coordinators[0]!.exit, "the coordinator's span ended").not.toBe("open")
    expect(coordinators[0]!.attributes.active).toBe(1)
    expect(e.spans.filter((s) => s.name === "wardic.clock" && s.exit === "open"), "the Clock is idle again").toHaveLength(0)
    expect(e.spans.filter((s) => s.name === COORDINATOR), "one coordinator span for the burst").toHaveLength(1)
  })
})

describe("the coordinator is one run on the Frame loop (#75)", () => {
  it("a FLIP is one run, named wardic.projection.coordinator with `active`, in the loop's last lane; it settles inside its step, so the run and its span succeed", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const element = box(0)
    const a = await register(e, "a", element)
    fireFrame()
    expect(e.coordinatorRuns(), "no run while nothing animates").toHaveLength(0)

    element.style.left = "200px"
    a.notify()
    await endOfTask()
    fireFrames(3)
    // The last lane (ADR-0027, *Amendment (#137)*): it reads what the spine legs wrote in the same tick.
    expect(e.coordinatorRuns()).toEqual([{ name: COORDINATOR, attributes: { active: 1 }, lane: "runLast", exit: "open" }])
    settle(sk, "a")
    expect(e.coordinatorRuns().map((r) => r.exit)).toEqual(["Success"])
    expect(e.spans.filter((s) => s.name === COORDINATOR).map((s) => s.exit)).toEqual(["Success"])
    expect(e.open()).toBe(0)
  })

  /** A FLIP of a 50 px box, three frames in: its handle and element. */
  const midFlip = async (e: Engine) => {
    const element = box(0)
    const a = await register(e, "a", element)
    fireFrame()
    element.style.left = "200px"
    a.notify()
    await endOfTask()
    fireFrames(3)
    return a
  }

  const stops: ReadonlyArray<readonly [string, (e: Engine) => Promise<() => void>]> = [
    [
      "a window width change finishing it",
      async (e) => {
        await midFlip(e)
        return () => {
          vi.stubGlobal("innerWidth", window.innerWidth - 200)
          window.dispatchEvent(new Event("resize"))
        }
      },
    ],
    [
      "a release in place",
      async (e) => {
        const b = await register(e, "b", box(0))
        fireFrame()
        b.dragStart()
        fireFrames(2)
        b.dragMove({ x: 30, y: 0 })
        fireFrame()
        return () => {
          b.dragMove({ x: 0, y: 0 })
          b.dragEnd()
        }
      },
    ],
    [
      "the last active node's dispose",
      async (e) => {
        const a = await midFlip(e)
        return () => a.dispose()
      },
    ],
    [
      "the system's dispose",
      async (e) => {
        await midFlip(e)
        return () => e.system.dispose()
      },
    ],
  ]

  for (const [name, setUp] of stops) {
    it(`a stop outside its step interrupts it: ${name}`, async () => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const stop = await setUp(e)
      expect(e.coordinatorRuns().map((r) => r.exit)).toEqual(["open"])
      stop()
      expect(e.coordinatorRuns().map((r) => r.exit), "ended in the stop's own call").toEqual(["Interrupted"])
      expect(e.spans.filter((s) => s.name === COORDINATOR).map((s) => s.exit)).toEqual(["Interrupted"])
      const writes = sk.writes.length
      await endOfTask()
      fireFrames(3)
      expect(sk.writes.length, "no write after the stop").toBe(writes)
      expect(e.open(), "nothing holds the Clock").toBe(0)
      expect(e.errors()).toEqual([])
      expect(e.reports()).toEqual([])
    })
  }

  it("one started inside the tick the last one settled in (a drag start from a later run's sink) is a second run, and the two never overlap", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const b = await register(e, "b", box(300))
    await midFlip(e)
    let settled = false
    let grabbed = false
    e.onSpanEnd((s) => {
      if (s.name === COORDINATOR) settled = true
    })
    // In the last lane, after the coordinator: a later run's sink in the tick it settles in.
    hold(
      e,
      () => {
        if (!settled || grabbed) return
        grabbed = true
        b.dragStart()
      },
      "runLast",
    )
    for (let i = 0; i < 600 && !grabbed; i++) fireFrame()
    expect(e.coordinatorRuns().map((r) => r.exit)).toEqual(["Success", "open"])
    fireFrame()
    b.dragMove({ x: 60, y: 0 })
    b.dragEnd()
    await endOfTask()
    settle(sk, "b")
    expect(e.coordinatorRuns().map((r) => r.exit)).toEqual(["Success", "Success"])
    expect(e.mostCoordinators()).toBe(1)
  })
})

describe("a step that throws fails the coordinator alone (ADR-0027, decision 7)", () => {
  it("logged once, with the defect; a run beside it keeps its Frames; the next trigger starts a fresh run, which settles the node", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    let held = 0
    hold(e, () => void held++)
    let failing = false
    const element = box(0)
    // A tween's easing, called each step (ADR-0009 *Amendment (#171)*): it throws once failing.
    const a = await register(e, "a", element, () =>
      Option.some({
        type: "tween",
        duration: 1,
        ease: (t) => {
          if (failing) throw new Error("easing failed")
          return t
        },
      }),
    )
    fireFrame()
    element.style.left = "200px"
    a.notify()
    await endOfTask()
    fireFrames(3)

    failing = true
    const heldBefore = held
    fireFrame()
    expect(e.errors().map((l) => l.message)).toEqual(["wardic.projection: coordinator failed"])
    expect(e.errors()[0]!.cause).toContain("easing failed")
    expect(e.reports(), "reported once, with the defect").toEqual(["easing failed"])
    expect(e.coordinatorRuns().map((r) => r.exit)).toEqual(["Failure"])
    const writes = sk.of("a").length
    fireFrames(3)
    expect(held - heldBefore, "the run beside it got every Frame").toBe(4)
    expect(sk.of("a").length, "the node waits where its last step left it").toBe(writes)
    expect(offset(sk.of("a").at(-1)!), "mid-flight").toBeGreaterThan(1)

    failing = false
    // A trigger that seeds nothing (the node's box didn't change) still starts a fresh run.
    a.notify()
    await endOfTask()
    settle(sk, "a")
    expect(offset(sk.of("a").at(-1)!), "the node settles on its slot").toBeLessThan(0.5)
    expect(e.coordinatorRuns().map((r) => r.exit)).toEqual(["Failure", "Success"])
    expect(e.errors()).toHaveLength(1)
    expect(e.reports()).toHaveLength(1)
  })
})
