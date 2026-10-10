/**
 * Core's frame bench (#63, ADR-0025): core's time per Refresh frame with N animated
 * elements, through core's real streams.
 *
 * - The Clock is `Clock.fromRefreshFrames` over a manual frame source, so the bench fires each
 *   Refresh frame itself.
 * - Each element is one fiber running one workload's stream into a sink, the binding's shape.
 * - One frame is: fire the Refresh frame callback, then wait until all N sinks have their frame.
 * - Effect's scheduler runs on microtasks (`MixedScheduler("sync")`), so the wait is CPU work,
 *   not `setTimeout` latency. #63 measured the scheduler's configuration as CPU-neutral.
 * - `start` is the construction time: forking all N fibers, through the Priming tick's frames.
 *
 * `run.ts` builds one bundle of this file per core (a base ref and the working tree) and runs
 * them in Bun, Node and Chromium.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scheduler from "effect/Scheduler"
import * as Stream from "effect/Stream"
import { AtomRegistry } from "effect/reactivity"
import type * as CoreModule from "../src/index.ts"

type Core = typeof CoreModule

export interface Options {
  /** Animated elements per frame. */
  readonly n: number
  /** Unmeasured frames before the measured window. */
  readonly warm: number
  /** Measured frames per round. */
  readonly frames: number
  /** Rounds per workload; the first is a JIT warm-up and is dropped. */
  readonly rounds: number
}

export interface WorkloadResult {
  /** Median ms per frame across the measured rounds. */
  readonly frameMs: number
  /** 95th percentile ms per frame. */
  readonly p95Ms: number
  /** Median ms to start all N streams, through the Priming tick's frames. */
  readonly startMs: number
  /** Bytes allocated per frame, when the host exposes it. */
  readonly bytesPerFrame?: number
}

/** A host hook for allocations: Node with `--expose-gc` (see `one.mjs`). */
interface Mem {
  readonly gc: () => void
  /** Bytes allocated so far: the used heap plus every byte a GC has freed. */
  readonly allocated: () => number
}

/** No heap hook: Bun and Chromium report no allocations. */
const NO_MEM: Mem = { gc: () => {}, allocated: () => 0 }

/** One fiber per element, each running a Primitive's `Stream` (the binding's shape before ADR-0027). */
interface StreamWorkload {
  readonly name: string
  readonly make: (core: Core, i: number) => Stream.Stream<{ readonly done: boolean }, never, any>
}

/**
 * Every element on one Frame loop (ADR-0027): each a run of its Primitive's machine. Only a core
 * with a `FrameLoop` runs these; the runner reports them, without a gate, until the base has them.
 */
interface LoopWorkload {
  readonly name: string
  readonly machine: (core: Core, i: number) => Effect.Effect<CoreModule.Machine.Machine<CoreModule.Frame.Frame<unknown>>, never, any>
}

/**
 * The services and the easing the bench reads, on either core across #95's modules: the working
 * tree's `Clock.Clock`, `Clock.fromRefreshFrames`, `FrameLoop.layer`, … or main's flat names
 * (`Clock`, `makeRefreshFrameClock`, `FrameLoopLive`, …). The harness is the working tree's and
 * runs both cores; the shim goes once main has the modules (as #94's did).
 */
interface Api {
  readonly Clock: typeof CoreModule.Clock.Clock
  readonly fromRefreshFrames: typeof CoreModule.Clock.fromRefreshFrames
  readonly registry: typeof CoreModule.InterpolatorRegistry.layer
  readonly frameLoop: typeof CoreModule.FrameLoop.layer
  readonly FrameLoop: typeof CoreModule.FrameLoop.FrameLoop
  readonly easeInOutCubic: CoreModule.Easing.Easing
}

/** Main's flat names, before #95. */
interface Main {
  readonly Clock: Api["Clock"]
  readonly makeRefreshFrameClock: Api["fromRefreshFrames"]
  readonly InterpolatorRegistryLive: Api["registry"]
  readonly FrameLoopLive: Api["frameLoop"]
  readonly FrameLoop: Api["FrameLoop"]
  readonly easeInOutCubic: Api["easeInOutCubic"]
}

const apiOf = (core: Core): Api => {
  if ("fromRefreshFrames" in core.Clock) {
    return {
      Clock: core.Clock.Clock,
      fromRefreshFrames: core.Clock.fromRefreshFrames,
      registry: core.InterpolatorRegistry.layer,
      frameLoop: core.FrameLoop.layer,
      FrameLoop: core.FrameLoop.FrameLoop,
      easeInOutCubic: core.Easing.easeInOutCubic,
    }
  }
  const main = core as unknown as Main
  return {
    Clock: main.Clock,
    fromRefreshFrames: main.makeRefreshFrameClock,
    registry: main.InterpolatorRegistryLive,
    frameLoop: main.FrameLoopLive,
    FrameLoop: main.FrameLoop,
    easeInOutCubic: main.easeInOutCubic,
  }
}

/** A machine built with a service (`animateValues`, `springBlend`), as a Stream. */
const streamOf = <F extends CoreModule.Frame.Frame<unknown>, R>(
  core: Core,
  machine: Effect.Effect<CoreModule.Machine.Machine<F>, never, R>,
): Stream.Stream<F, never, any> => Stream.unwrap(Effect.map(machine, core.Machine.toStream))

type Workload = StreamWorkload | LoopWorkload

const isLoopWorkload = (workload: Workload): workload is LoopWorkload => "machine" in workload

/** A value in [base, base + span), spread over the elements so no call site sees a constant. */
const spread = (i: number, base: number, span: number): number => base + (((i * 7919) % 1000) / 1000) * span

const STRING_FROM = (i: number) => ({
  "background-color": "#000000",
  width: `${spread(i, 10, 20).toFixed(1)}px`,
  "pointer-events": "auto",
  opacity: 0,
})
const STRING_TO = { "background-color": "#ffffff", width: "200px", "pointer-events": "none", opacity: 1 }

/**
 * Two complex values of one structure each (ADR-0015): an icon-sized SVG `d` (20 numbers) and a
 * `box-shadow`, whose rgba channels blend as plain numbers. Through `complex`, the only tier
 * the string workloads above don't reach (#65).
 */
const COMPLEX_FROM = (i: number) => ({
  d: `M${spread(i, 10, 4).toFixed(2)} 2 C6.48 2 2 6.48 2 12 S6.48 22 12 22 S22 17.52 22 12 S17.52 2 12 2 Z`,
  "box-shadow": `0px 0px ${spread(i, 0, 4).toFixed(1)}px rgba(0,0,0,0)`,
})
const COMPLEX_TO = {
  d: "M12 4 C8 4 4 8 4 12 S8 20 12 20 S20 16 20 12 S16 4 12 4 Z",
  "box-shadow": "4px 8px 24px rgba(0,0,0,0.25)",
}

/** `springValues`' arguments: four keys, travelling at least 50. */
const SPRING = (i: number) =>
  [{ x: spread(i, 50, 100), y: spread(i, -120, 40), scale: 1.2, opacity: 1 }, {}, { x: 0, y: 0, scale: 1, opacity: 0 }] as const

/**
 * `animateValues`' deepest stack (ADR-0028, decision 7): an infinite `repeat` with `yoyo`, and a
 * `delay` spread over the elements, so each element's seams fall on different frames. A 0.15 s
 * segment is about 9 frames, so two or three seams fall inside the measured window.
 */
const REPEAT = (core: Core, i: number) => ({
  duration: 0.15,
  easing: apiOf(core).easeInOutCubic,
  repeat: Number.POSITIVE_INFINITY,
  yoyo: true,
  delay: spread(i, 0, 0.2),
})

/**
 * `animateRepeat` with a gap between runs (#91): each run holds where it ended for 0.1 s, so
 * each element's holds and seams fall on different frames inside the measured window.
 */
const REPEAT_DELAY = (core: Core, i: number) => ({ ...REPEAT(core, i), repeatDelay: 0.1 })

let chaseTarget = 0

/**
 * None of these settles inside `warm + frames` (36) frames: the springs travel at least 50 and
 * settle around frame 53, the tween runs 2 s, an infinite `repeat` (with or without a
 * `repeatDelay`) and a chase never settle.
 */
const WORKLOADS: ReadonlyArray<Workload> = [
  {
    // The floor and the noise control: each element consumes the Clock's ticks with no
    // primitive. Its code is the same in every core, so its ratio is the run's noise.
    name: "ticksOnly",
    make: (core) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const clock = yield* apiOf(core).Clock
          return clock.ticks.pipe(Stream.map(() => ({ done: false })))
        }),
      ),
  },
  { name: "springValues", make: (core, i) => core.Machine.toStream(core.Machine.springValues(...SPRING(i))) },
  {
    name: "animateValues",
    make: (core, i) =>
      streamOf(core, core.Machine.animateValues(STRING_FROM(i), STRING_TO, { duration: 2, easing: apiOf(core).easeInOutCubic })),
  },
  { name: "springBlend", make: (core, i) => streamOf(core, core.Machine.springBlend(STRING_FROM(i), STRING_TO)) },
  { name: "chase", make: (core, i) => core.Machine.toStream(core.Machine.chase(() => chaseTarget + (i % 10))) },
  {
    name: "animateComplex",
    make: (core, i) =>
      streamOf(core, core.Machine.animateValues(COMPLEX_FROM(i), COMPLEX_TO, { duration: 2, easing: apiOf(core).easeInOutCubic })),
  },
  { name: "animateRepeat", make: (core, i) => streamOf(core, core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT(core, i))) },
  {
    name: "animateRepeatDelay",
    make: (core, i) => streamOf(core, core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT_DELAY(core, i))),
  },
  // The same seven, on the Frame loop.
  { name: "springValues/loop", machine: (core, i) => Effect.succeed(core.Machine.springValues(...SPRING(i))) },
  {
    name: "animateValues/loop",
    machine: (core, i) => core.Machine.animateValues(STRING_FROM(i), STRING_TO, { duration: 2, easing: apiOf(core).easeInOutCubic }),
  },
  { name: "springBlend/loop", machine: (core, i) => core.Machine.springBlend(STRING_FROM(i), STRING_TO) },
  { name: "chase/loop", machine: (core, i) => Effect.succeed(core.Machine.chase(() => chaseTarget + (i % 10))) },
  {
    name: "animateComplex/loop",
    machine: (core, i) =>
      core.Machine.animateValues(COMPLEX_FROM(i), COMPLEX_TO, { duration: 2, easing: apiOf(core).easeInOutCubic }),
  },
  { name: "animateRepeat/loop", machine: (core, i) => core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT(core, i)) },
  {
    name: "animateRepeatDelay/loop",
    machine: (core, i) => core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT_DELAY(core, i)),
  },
]

export const WORKLOAD_NAMES: ReadonlyArray<string> = WORKLOADS.map((w) => w.name)

const quantile = (xs: ReadonlyArray<number>, p: number): number =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!

/** A Refresh frame source the bench fires by hand. */
const manualFrames = () => {
  let pending: Array<(t: number) => void> = []
  return {
    source: {
      requestFrame: (callback: (t: number) => void) => {
        pending.push(callback)
        return callback
      },
      cancelFrame: (handle: (t: number) => void) => {
        pending = pending.filter((callback) => callback !== handle)
      },
      now: () => performance.now(),
    },
    fire: (timestamp: number) => {
      const callbacks = pending
      pending = []
      for (const callback of callbacks) callback(timestamp)
    },
  }
}

const runRound = async (core: Core, workload: Workload, options: Options) => {
  const frames = manualFrames()
  const api = apiOf(core)
  const services = Layer.mergeAll(Layer.effect(api.Clock)(api.fromRefreshFrames(frames.source)), api.registry)
  // Only the loop workloads build a Frame loop, so the Stream workloads' Environment is the same in both cores.
  let environment: Layer.Layer<any, never, AtomRegistry.AtomRegistry> = services
  if (isLoopWorkload(workload)) environment = api.frameLoop.pipe(Layer.provideMerge(services))
  const layer = environment.pipe(
    Layer.provideMerge(AtomRegistry.layer),
    Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))),
  )
  const runtime = ManagedRuntime.make(layer)
  await runtime.runPromise(Effect.void)

  let received = 0
  let waiter: { readonly target: number; readonly resolve: () => void } | undefined
  const waitFor = (target: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${workload.name}: stuck at ${received} of ${target} frames (did a stream settle?)`)),
        10_000,
      )
      waiter = {
        target,
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
      }
      if (received >= target) waiter.resolve()
    })
  const receive = (): undefined => {
    received++
    if (waiter !== undefined && received >= waiter.target) {
      const done = waiter
      waiter = undefined
      done.resolve()
    }
    return undefined
  }
  const sink = Effect.sync(receive)

  const t0 = performance.now()
  if (isLoopWorkload(workload)) {
    for (let i = 0; i < options.n; i++) {
      runtime.runFork(
        Effect.gen(function* () {
          const loop = yield* api.FrameLoop
          return yield* loop.run(yield* workload.machine(core, i), receive)
        }),
      )
    }
  } else {
    for (let i = 0; i < options.n; i++) runtime.runFork(Stream.runForEach(workload.make(core, i), () => sink))
  }
  await waitFor(options.n)
  const startMs = performance.now() - t0

  let timestamp = 1000
  const step = async () => {
    timestamp += 1000 / 60
    chaseTarget += 3
    const target = received + options.n
    frames.fire(timestamp)
    await waitFor(target)
  }
  for (let f = 0; f < options.warm; f++) await step()

  // Allocations: only where the host hands over a heap hook (Node, `one.mjs`). It counts what a
  // GC frees inside the window too, so a scavenge there doesn't hide allocation (#65).
  const mem: Mem = (globalThis as { readonly __mem?: Mem }).__mem || NO_MEM
  mem.gc()
  const allocated0 = mem.allocated()
  const times: Array<number> = []
  for (let f = 0; f < options.frames; f++) {
    const f0 = performance.now()
    await step()
    times.push(performance.now() - f0)
  }
  const bytes: Array<number> = []
  if (mem !== NO_MEM) bytes.push((mem.allocated() - allocated0) / options.frames)

  await runtime.dispose()
  return { times, startMs, bytes }
}

/** Run every workload against `core`; registered on `globalThis.__wardicBench` for the runners. */
export const register = (core: Core): void => {
  ;(globalThis as Record<string, unknown>).__wardicBench = async (
    options: Options,
  ): Promise<Record<string, WorkloadResult>> => {
    const out: Record<string, WorkloadResult> = {}
    for (const workload of WORKLOADS) {
      // A core from before ADR-0027 has no Frame loop: its results have no loop workloads.
      if (isLoopWorkload(workload) && !("FrameLoop" in core)) continue
      const times: Array<number> = []
      const starts: Array<number> = []
      const bytes: Array<number> = []
      for (let r = 0; r < options.rounds; r++) {
        const round = await runRound(core, workload, options)
        if (r === 0) continue
        times.push(...round.times)
        starts.push(round.startMs)
        bytes.push(...round.bytes)
      }
      const result: { -readonly [K in keyof WorkloadResult]: WorkloadResult[K] } = {
        frameMs: quantile(times, 0.5),
        p95Ms: quantile(times, 0.95),
        startMs: quantile(starts, 0.5),
      }
      if (bytes.length > 0) result.bytesPerFrame = quantile(bytes, 0.5)
      out[workload.name] = result
    }
    return out
  }
}
