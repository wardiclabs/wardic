// The projection coordinator's lifecycle (ADR-0009, ADR-0018; #75 makes it a run on the Frame
// loop, ADR-0027). Checked against a fake ProjectionSink with Refresh frames fired by hand, on
// DomLive's own parts, composed as DomLive composes them, with the Clock wrapped to count its open
// `ticks` subscriptions, a Tracer that records every span, and a logger that records every log.
//
// - A coordinator that settled is started afresh by the next trigger, cold or warm.
// - One started inside a tick, after the coordinator settled earlier in that tick, is stepped from
//   the next tick.
// - Disposing the system mid-burst, a release in place and the last active node's dispose stop it:
//   no write after, and the Clock's subscription goes once nothing else runs.
// - The layout lab's reading: a Tracer merged beside the Environment sees the coordinator's span
//   and a `wardic.clock` span open while a lone FLIP runs.
import { describe, expect, it } from "@effect/vitest"
import {
  Clock,
  type Frame,
  FrameLoop,
  FrameLoopLive,
  InterpolatorRegistryLive,
  type Machine,
} from "@wardic/core"
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as References from "effect/References"
import { AtomRegistry } from "effect/reactivity"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import { afterEach, beforeEach } from "vitest"
import {
  ClockDomLive,
  InputDomLive,
  makeProjectionSystem,
  type ProjectionNodeHandle,
  ProbeDomLive,
  RendererDomLive,
} from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, fireFrames, makeSink, stage, stubFrames, unstubFrames, type Write } from "./projection-harness.ts"

type ClockShape = Context.Service.Shape<typeof Clock>
type NativeSpanOptions = ConstructorParameters<typeof Tracer.NativeSpan>[0]

/** One span the Tracer saw: its attributes and how it ended, filled in at its end. */
interface SpanRecord {
  readonly name: string
  attributes: Record<string, unknown>
  exit: "open" | "Success" | "Failure" | "Interrupted"
}

/** One log the Environment's logger saw. */
interface Logged {
  readonly level: string
  readonly message: string
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
 * went idle opens another).
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
  const env = FrameLoopLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.effect(Clock)(Clock.useSync(countTicks)).pipe(Layer.provide(ClockDomLive)),
        RendererDomLive,
        InputDomLive,
        ProbeDomLive,
        InterpolatorRegistryLive,
      ),
    ),
    Layer.provideMerge(AtomRegistry.layer),
  )
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      env,
      Layer.succeed(Tracer.Tracer, Tracer.make({ span: (options) => new RecordingSpan(options) })),
      Logger.layer([
        Logger.map(Logger.formatStructured, (s) => {
          logs.push({ level: s.level, message: String(s.message) })
        }),
      ]),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
    ),
  )
  const system = makeProjectionSystem(runtime, sink)
  engines.push({ system, runtime })
  return {
    system,
    runtime,
    spans,
    logs,
    open: () => open,
    most: () => most,
    onSpanEnd: (listener: (record: SpanRecord) => void) => spanEnds.push(listener),
    errors: () => logs.filter((l) => l.level === "ERROR"),
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
const register = async (e: Engine, id: string, element: HTMLElement): Promise<ProjectionNodeHandle> => {
  const handle = e.system.register({ id, element, springOptions: () => ({}) })
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

/** A run of the test's own on the Frame loop that never settles, handing each Frame to `onFrame`. */
const hold = (e: Engine, onFrame: () => void = () => {}) => {
  const machine: Machine<Frame<number>> = {
    settles: false,
    span: { name: "test.hold", attributes: {} },
    start: () => () => ({ value: 0, done: false }),
  }
  return e.runtime.runFork(
    FrameLoop.use((loop) =>
      loop.run(machine, () => {
        onFrame()
        return undefined
      }),
    ),
  )
}

describe("a coordinator that settled is started afresh by the next trigger", () => {
  for (const clock of ["cold", "warm"] as const) {
    it(`${clock}: the node moves one step before any Refresh frame, then settles on its slot`, async () => {
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
      const since = sk.of("a").slice(before)
      expect(since.length, "the seed, then one step").toBe(2)
      expect(Math.abs(since[0]!.tx - 200), "the seed paints the origin").toBeLessThan(0.5)
      expect(offset(since[1]!), "the first step moved it").toBeLessThan(offset(since[0]!))
      settle(sk, "a")
      expect(offset(sk.of("a").at(-1)!), "the second FLIP ends on its slot").toBeLessThan(0.5)
      expect(e.errors()).toEqual([])
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

    // A run of the test's own, started after the coordinator, so the loop steps it after the
    // coordinator in each tick. Its first Frame after the coordinator's span ends grabs b.
    let frame = 0
    let settledAt = -1
    let grabbedAt = -1
    let bWritesAtGrab = 0
    e.onSpanEnd((s) => {
      if (s.name === COORDINATOR && settledAt < 0) settledAt = frame
    })
    hold(e, () => {
      if (settledAt < 0 || grabbedAt >= 0) return
      grabbedAt = frame
      b.dragStart()
      bWritesAtGrab = sk.of("b").length
    })
    for (let i = 0; i < 600 && grabbedAt < 0; i++) {
      frame++
      fireFrame()
    }
    expect(settledAt, "the coordinator settled").toBeGreaterThan(0)
    expect(grabbedAt, "the grab came in the tick the coordinator settled in").toBe(settledAt)
    expect(sk.of("b").length, "only the grab's own derive in that tick").toBe(bWritesAtGrab)

    frame++
    fireFrame()
    expect(sk.of("b").length, "the new coordinator derives b at the next tick").toBeGreaterThan(bWritesAtGrab)

    b.dragMove({ x: 60, y: 0 })
    b.dragEnd()
    await endOfTask()
    settle(sk, "b")
    expect(offset(sk.of("b").at(-1)!), "the release ends on b's slot").toBeLessThan(0.5)
    expect(e.errors()).toEqual([])
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
