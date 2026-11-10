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
 * - `start` is the construction time: forking all N fibers, through their first frames. A core
 *   before #73 delivers them at the end of the starting task (the Priming tick); since #73 the
 *   first tick is the first Refresh frame's (ADR-0033), which the bench fires there.
 *
 * `run.ts` builds one bundle of this file per core (a base ref and the working tree) and runs
 * them in Bun, Node and Chromium. It reads core's modules (ADR-0028), so a base ref is #95 or later.
 */
/// <reference path="./culori.d.ts" />
import { formatRgb, interpolate as culoriInterpolate, parse as culoriParse } from "culori"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
// Only for a base core before #511, whose Interpolators were Schema codecs (`colorEntry`).
import * as Schema from "effect/Schema"
import type * as SchemaTransformation from "effect/SchemaTransformation"
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
  /** Median ms to start all N streams, through their first frames. */
  readonly startMs: number
  /** Bytes allocated per frame, when the host exposes it. */
  readonly bytesPerFrame?: number
  /** How many runs it timed: N, or N times its `scale` (#545). A harness before #545 reports none. */
  readonly runs?: number
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
  /** Whether `core` has what it runs: a workload a base lacks is left out, and reported as new (`rows.ts`). */
  readonly runsOn?: (core: Core) => boolean
}

/** Every element on one Frame loop (ADR-0027): each a run of its Primitive's machine. */
interface LoopWorkload {
  readonly name: string
  readonly machine: (core: Core, i: number) => Effect.Effect<CoreModule.Machine.Machine<CoreModule.Frame.Frame<unknown>>, never, any>
  /** As {@link StreamWorkload}'s. */
  readonly runsOn?: (core: Core) => boolean
  /**
   * Runs per element of N (#545): a workload whose frame at N runs under 0.1 ms is timed at N times
   * this, so its frame is well above the timer (Chromium's 5 µs) and the harness's own hop.
   */
  readonly scale?: number
}

/**
 * One run for every element (#665): a Batch's, or the hand loop it's measured against. Its run
 * steps all `n` members each tick and calls `onFrame` once; the harness counts that as `n` frames.
 */
interface BatchWorkload {
  readonly name: string
  readonly batch: (core: Core, n: number, onFrame: () => void) => Effect.Effect<void, never, any>
  /** As {@link StreamWorkload}'s. */
  readonly runsOn?: (core: Core) => boolean
  /** As {@link LoopWorkload}'s: members per element of N. */
  readonly scale?: number
}

/** A machine built with a service (`animateValues`, `springBlend`), as a Stream. */
const streamOf = <F extends CoreModule.Frame.Frame<unknown>, R>(
  core: Core,
  machine: Effect.Effect<CoreModule.Machine.Machine<F>, never, R>,
): Stream.Stream<{ readonly done: boolean }, never, any> =>
  // Typed by what the bench reads (#663): `toStream` emits a `springValues` Frame's records alone.
  Stream.unwrap(Effect.map(machine, core.Machine.toStream)) as Stream.Stream<{ readonly done: boolean }, never, any>

type Workload = StreamWorkload | LoopWorkload | BatchWorkload

const isLoopWorkload = (workload: Workload): workload is LoopWorkload => "machine" in workload

const isBatchWorkload = (workload: Workload): workload is BatchWorkload => "batch" in workload

/** How many runs a workload times: N, times its `scale` (#545); a Batch's members, counted as runs. */
const runsOf = (workload: Workload, options: Options): number => {
  if (isBatchWorkload(workload) && workload.scale !== undefined) return options.n * workload.scale
  if (!isLoopWorkload(workload) || workload.scale === undefined) return options.n
  return options.n * workload.scale
}

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
 * `box-shadow`, whose `rgba()` blends as a colour since #61 (as plain numbers before), through the
 * harness's colours since #160 (`registryOf`). Through `complex`, the only tier the string
 * workloads above don't reach (#65).
 */
const COMPLEX_FROM = (i: number) => ({
  d: `M${spread(i, 10, 4).toFixed(2)} 2 C6.48 2 2 6.48 2 12 S6.48 22 12 22 S22 17.52 22 12 S17.52 2 12 2 Z`,
  "box-shadow": `0px 0px ${spread(i, 0, 4).toFixed(1)}px rgba(0,0,0,0)`,
})
const COMPLEX_TO = {
  d: "M12 4 C8 4 4 8 4 12 S8 20 12 20 S20 16 20 12 S16 4 12 4 Z",
  "box-shadow": "4px 8px 24px rgba(0,0,0,0.25)",
}

/**
 * `springValues`' arguments: four keys, travelling at least 50. Its start is a bag since #618 (F3), a
 * positional record before; `Playback.setSpeed` came in with it, so a core that has it takes the bag,
 * and base and head run the same springs across it.
 */
const SPRING = (core: Core, i: number): Parameters<typeof CoreModule.Machine.springValues> => {
  const target = { x: spread(i, 50, 100), y: spread(i, -120, 40), scale: 1.2, opacity: 1 }
  const from = { x: 0, y: 0, scale: 1, opacity: 0 }
  return Bool.match("setSpeed" in core.Playback, {
    onTrue: () => [target, {}, { from }],
    onFalse: () => [target, {}, from] as unknown as Parameters<typeof CoreModule.Machine.springValues>,
  })
}

/**
 * A tween's easing under the key `core` reads (#360): `ease` since the rename, `easing` before it,
 * so base and head run the same curve across it. A core since #360 rejects `easing`, so each gets
 * only its own.
 */
const easeFor = (core: Core, easing: (t: number) => number): CoreModule.Machine.AnimateOptions =>
  Bool.match("resolve" in core.Easing, {
    onTrue: () => ({ ease: easing }) as CoreModule.Machine.AnimateOptions,
    onFalse: () => ({ easing }) as unknown as CoreModule.Machine.AnimateOptions,
  })

/**
 * `animateValues` with every modifier (ADR-0028, decision 7; one leaf since #226, where it was the
 * deepest stack): an infinite `repeat` turned every other run, and a `delay` spread over the
 * elements, so each element's turns fall on different frames. A 0.15 s run is about 9 frames, so
 * two or three turns fall inside the measured window.
 */
const REPEAT = (core: Core, i: number) => ({
  duration: 0.15,
  ...easeFor(core, core.Easing.easeInOutCubic),
  repeat: Number.POSITIVE_INFINITY,
  // Every other run turned: `repeatType` since #226, `yoyo` before it. Each core reads its own key and
  // ignores the other, so base and head run the same workload across the rename.
  repeatType: "mirror" as const,
  yoyo: true,
  delay: spread(i, 0, 0.2),
})

/**
 * `animateRepeat` with a gap between runs (#91): each run holds where it ended for 0.1 s, so
 * each element's holds and seams fall on different frames inside the measured window.
 */
const REPEAT_DELAY = (core: Core, i: number) => ({ ...REPEAT(core, i), repeatDelay: 0.1 })

/** The string workloads' keys through three stops each (#429): from, a stop between, and to. */
const KEYFRAMES = (i: number) => {
  const from = STRING_FROM(i)
  return {
    "background-color": [from["background-color"], "#808080", STRING_TO["background-color"]],
    width: [from.width, "100px", STRING_TO.width],
    "pointer-events": [from["pointer-events"], "auto", STRING_TO["pointer-events"]],
    opacity: [from.opacity, 0.5, STRING_TO.opacity],
  }
}

/**
 * `keyframesValues`' bag (#429): a stop placed off the even spacing, an `ease` per Segment, and
 * `animateRepeat`'s infinite mirrored repeat and spread `delay`, so each element's Segments and
 * turns fall on different frames inside the measured window.
 */
const KEYFRAMES_REPEAT = (core: Core, i: number): CoreModule.Machine.KeyframesOptions => ({
  ...REPEAT(core, i),
  times: [0, 0.3, 1],
  ease: [core.Easing.easeInOutCubic, core.Easing.easeOutCubic],
})

/** Whether `core` has `keyframesValues` (#429). */
const hasKeyframesValues = (core: Core): boolean => "keyframesValues" in core.Machine

let chaseTarget = 0

/** Whether `core` has a Batch (#665). */
const hasBatch = (core: Core): boolean => "Batch" in core

/** The Batch workloads' keys and each member's target, as `springValues`' workloads spread theirs. */
const BATCH_KEYS = ["x", "y"]
const batchTarget = (slot: number, k: number): number => {
  if (k === 0) return spread(slot, 50, 100)
  return spread(slot, -120, 40)
}

/** A second spring, for the members of `batch/table` that don't run the Batch's own: it settles later. */
const GENTLE = { type: "spring", stiffness: 120, damping: 14 } as const

/**
 * A Batch of `n` members springing `x` and `y` (#665), each drawn into a number, as a writer draws an
 * element; with `table`, every other member on {@link GENTLE}, the Batch's table holding two.
 */
const batchRun = (core: Core, n: number, onFrame: () => void, table: boolean): Effect.Effect<void, never, any> =>
  Effect.suspend(() => {
    const drawn = new Float64Array(n)
    const writer: CoreModule.Batch.Writer<number> = {
      writes: () => true,
      forKeys: () => (member, positions, base) => {
        drawn[member] = positions[base]! + positions[base + 1]!
      },
    }
    const batch = core.Batch.make({ keys: BATCH_KEYS, writer, transition: { type: "spring" }, capacity: n, onFrame })
    const slots = Array.from({ length: n }, (_, i) => core.Batch.enter(batch, i, { x: 0, y: 0 }))
    if (!table) core.Batch.retarget(batch, slots, batchTarget)
    if (table) {
      core.Batch.retarget(batch, slots.filter((slot) => slot % 2 === 0), batchTarget)
      core.Batch.retarget(batch, slots.filter((slot) => slot % 2 === 1), batchTarget, { transition: GENTLE })
    }
    return core.Batch.run(batch)
  })

/**
 * The probe's hand loop (#665, `.tmp/564-canvas/perf/group.ts`): one spring for every key, no table,
 * the moving members in a list, each stepped by `Spring.matrixFor` and drawn. A Batch's table is held to
 * it (ADR-0069, *Amendment (#665)*: within 5%).
 */
const probeRun = (core: Core, n: number, onFrame: () => void): Effect.Effect<void, never, any> =>
  Effect.suspend(() => {
    const K = BATCH_KEYS.length
    const pos = new Float64Array(n * K)
    const vel = new Float64Array(n * K)
    const goal = new Float64Array(n * K)
    const restD = new Float64Array(n * K)
    const restS = new Float64Array(n * K)
    const drawn = new Float64Array(n)
    const list = new Int32Array(n)
    const spring = core.Spring.resolve({})
    for (let i = 0; i < n; i++) {
      list[i] = i
      for (let k = 0; k < K; k++) {
        const at = i * K + k
        goal[at] = batchTarget(i, k)
        restD[at] = core.Spring.restDeltaFor(spring, goal[at]!)
        restS[at] = core.Spring.restSpeedFor(spring, goal[at]!)
      }
    }
    let count = n
    const frame = { value: 0, done: false }
    const machine = core.Machine.make({
      settles: true,
      span: { name: "bench.probe", attributes: {} },
      start: () => (dt: number) => {
        const m = core.Spring.matrixFor(spring, Math.min(dt, core.Machine.MAX_DT))
        let kept = 0
        for (let a = 0; a < count; a++) {
          const i = list[a]!
          const base = i * K
          let moving = false
          for (let k = 0; k < K; k++) {
            const at = base + k
            const g = goal[at]!
            const d = pos[at]! - g
            const v = vel[at]!
            let p = g + m.dd * d + m.dv * v
            let speed = m.vd * d + m.vv * v
            if (Math.abs(speed) <= restS[at]! && Math.abs(p - g) <= restD[at]!) {
              p = g
              speed = 0
            } else moving = true
            pos[at] = p
            vel[at] = speed
          }
          drawn[i] = pos[base]! + pos[base + 1]!
          if (moving) list[kept++] = i
        }
        count = kept
        onFrame()
        frame.done = count === 0
        return frame
      },
    })
    return Effect.asVoid(core.Machine.run(machine, () => undefined))
  })

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
          const clock = yield* core.Clock.Clock
          return clock.ticks.pipe(Stream.map(() => ({ done: false })))
        }),
      ),
  },
  { name: "springValues", make: (core, i) => core.Machine.toStream(core.Machine.springValues(...SPRING(core, i))) },
  {
    name: "animateValues",
    make: (core, i) =>
      streamOf(core, core.Machine.animateValues(STRING_FROM(i), STRING_TO, { duration: 2, ...easeFor(core, core.Easing.easeInOutCubic) })),
  },
  { name: "springBlend", make: (core, i) => streamOf(core, core.Machine.springBlend(STRING_FROM(i), STRING_TO)) },
  { name: "chase", make: (core, i) => core.Machine.toStream(core.Machine.chase(() => chaseTarget + (i % 10))) },
  {
    name: "animateComplex",
    make: (core, i) =>
      streamOf(core, core.Machine.animateValues(COMPLEX_FROM(i), COMPLEX_TO, { duration: 2, ...easeFor(core, core.Easing.easeInOutCubic) })),
  },
  { name: "animateRepeat", make: (core, i) => streamOf(core, core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT(core, i))) },
  {
    name: "animateRepeatDelay",
    make: (core, i) => streamOf(core, core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT_DELAY(core, i))),
  },
  {
    name: "keyframesValues",
    make: (core, i) => streamOf(core, core.Machine.keyframesValues(KEYFRAMES(i), KEYFRAMES_REPEAT(core, i))),
    runsOn: hasKeyframesValues,
  },
  // The same eight, on the Frame loop. The two under 0.1 ms a frame at N run ten times N (#545):
  // run against itself, `chase/loop`'s spread was 25–29 points on Bun and Chromium at N.
  { name: "springValues/loop", machine: (core, i) => Effect.succeed(core.Machine.springValues(...SPRING(core, i))), scale: 10 },
  {
    name: "animateValues/loop",
    machine: (core, i) => core.Machine.animateValues(STRING_FROM(i), STRING_TO, { duration: 2, ...easeFor(core, core.Easing.easeInOutCubic) }),
  },
  { name: "springBlend/loop", machine: (core, i) => core.Machine.springBlend(STRING_FROM(i), STRING_TO) },
  { name: "chase/loop", machine: (core, i) => Effect.succeed(core.Machine.chase(() => chaseTarget + (i % 10))), scale: 10 },
  {
    name: "animateComplex/loop",
    machine: (core, i) =>
      core.Machine.animateValues(COMPLEX_FROM(i), COMPLEX_TO, { duration: 2, ...easeFor(core, core.Easing.easeInOutCubic) }),
  },
  { name: "animateRepeat/loop", machine: (core, i) => core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT(core, i)) },
  {
    name: "animateRepeatDelay/loop",
    machine: (core, i) => core.Machine.animateValues(STRING_FROM(i), STRING_TO, REPEAT_DELAY(core, i)),
  },
  {
    name: "keyframesValues/loop",
    machine: (core, i) => core.Machine.keyframesValues(KEYFRAMES(i), KEYFRAMES_REPEAT(core, i)),
    runsOn: hasKeyframesValues,
  },
  // A Batch (#665): every member in one run, at ten times N as the loop workloads under 0.1 ms are. With
  // two transitions in its table, and the probe's hand loop with one: the table's cost, at the end.
  { name: "batch", batch: (core, n, onFrame) => batchRun(core, n, onFrame, false), runsOn: hasBatch, scale: 10 },
  { name: "batch/table", batch: (core, n, onFrame) => batchRun(core, n, onFrame, true), runsOn: hasBatch, scale: 10 },
  { name: "batch/probe", batch: probeRun, scale: 10 },
]

export const WORKLOAD_NAMES: ReadonlyArray<string> = WORKLOADS.map((w) => w.name)

/** A colour as culori holds it. */
type Color = { readonly mode: string; readonly [channel: string]: number | string | undefined }

const isColor = (value: unknown): value is Color => Predicate.hasProperty(value, "mode")

/** culori's `parse`, trimmed, with a throw or a rejection read as no colour. */
const parseColor = (input: string): Option.Option<Color> =>
  Option.filter(Option.flatMap(Option.liftThrowable(culoriParse)(input.trim()), Option.fromUndefinedOr), isColor)

/** A colour string read, as an entry's `parse` reads any value (#511): `None` for one that isn't a string. */
const parseColorValue = (value: unknown): Option.Option<Color> => Option.flatMap(Option.liftPredicate(value, Predicate.isString), parseColor)

const formatColor = (value: Color): string => formatRgb(value)

/** A core before #511, whose entries read and write through a Schema codec built on its `parseAndFormat`. */
interface SchemaInterpolator {
  readonly parseAndFormat: (
    parse: (input: string) => Option.Option<Color>,
    format: (value: Color) => string,
  ) => SchemaTransformation.Transformation<Color, string>
}

/**
 * The harness's colour entry for `core`: a `parse` and `format` since #511 (ADR-0026, *Amendment
 * (#511)*), a Schema codec before it, built on the same two.
 */
const colorEntry = (core: Core, blend: CoreModule.Interpolator.Entry<Color, string>["blend"]): CoreModule.Interpolator.Entry<Color, string> => {
  const name = "color(rgb)"
  if (!("parseAndFormat" in core.Interpolator)) return { name, parse: parseColorValue, format: formatColor, blend }
  const transformation = (core.Interpolator as unknown as SchemaInterpolator).parseAndFormat(parseColor, formatColor)
  const codec = Schema.String.pipe(Schema.decodeTo(Schema.declare(isColor), transformation))
  return { name, codec, blend } as unknown as CoreModule.Interpolator.Entry<Color, string>
}

/** A colour inside a complex value (`@wardic/dom`'s `COLOR_TOKEN`). */
const COLOR_TOKEN = /#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)/

/**
 * The registry the workloads blend through (#160, ADR-0036). A core before #160 has colours of its
 * own, `Interpolator.color` (culori in sRGB), in its default registry. Since #160 core has none,
 * and the harness brings culori's sRGB blend, as a tier and as a kind of token in the complex tier,
 * as the DOM Environment registers its colours (`@wardic/dom`'s `colors.ts`, which the bundle can't
 * import: it would bring another core). Both sides blend the same colours the same way, so a
 * ratio still compares the two cores. The DOM's own sRGB blend (#156) writes the same strings at
 * a lower cost, so the workloads' colours cost more here than in the DOM.
 */
const registryOf = (core: Core): Layer.Layer<CoreModule.InterpolatorRegistry.InterpolatorRegistry> => {
  if ("color" in core.Interpolator) return core.InterpolatorRegistry.layer
  const color = colorEntry(core, (from, to) => {
    const at = culoriInterpolate([from, to], "rgb")
    return Option.some((t: number) => formatRgb(at(t)))
  })
  const complex = core.Interpolator.complexWith({ tokens: [{ pattern: COLOR_TOKEN, entry: color }] })
  const entries = [core.Interpolator.number, core.Interpolator.array, color, core.Interpolator.unit, complex]
  return Layer.effect(core.InterpolatorRegistry.InterpolatorRegistry)(core.InterpolatorRegistry.make(entries))
}

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
    /** Whether a Refresh frame is requested. */
    requested: () => pending.length > 0,
  }
}

const runRound = async (
  core: Core,
  registry: Layer.Layer<CoreModule.InterpolatorRegistry.InterpolatorRegistry>,
  workload: Workload,
  options: Options,
) => {
  const frames = manualFrames()
  const services = Layer.mergeAll(
    Layer.effect(core.Clock.Clock)(core.Clock.fromRefreshFrames(frames.source)),
    registry,
  )
  // Only the loop workloads build a Frame loop, so the Stream workloads' Environment is the same in both cores.
  let environment: Layer.Layer<any, never, AtomRegistry.AtomRegistry> = services
  if (isLoopWorkload(workload) || isBatchWorkload(workload)) environment = core.FrameLoop.layer.pipe(Layer.provideMerge(services))
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

  const n = runsOf(workload, options)
  const t0 = performance.now()
  if (isBatchWorkload(workload)) {
    // One run for the n members: each tick it steps is n frames.
    runtime.runFork(workload.batch(core, n, () => {
      received += n - 1
      receive()
    }))
  } else if (isLoopWorkload(workload)) {
    for (let i = 0; i < n; i++) {
      runtime.runFork(
        Effect.gen(function* () {
          const loop = yield* core.FrameLoop.FrameLoop
          return yield* loop.run(yield* workload.machine(core, i), receive)
        }),
      )
    }
  } else {
    for (let i = 0; i < n; i++) runtime.runFork(Stream.runForEach(workload.make(core, i), () => sink))
  }
  // The first frames: a core before #73 delivers them in a Priming tick at the end of this task;
  // since #73 (ADR-0033) the first tick is the first Refresh frame's, requested at the end of
  // this task, which the bench fires. Both are one tick at the nominal dt.
  for (let i = 0; i < 100 && received < n && !frames.requested(); i++) await Promise.resolve()
  if (received < n) frames.fire(1000)
  await waitFor(n)
  const startMs = performance.now() - t0

  let timestamp = 1000
  const step = async () => {
    timestamp += 1000 / 60
    chaseTarget += 3
    const target = received + n
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
  const registry = registryOf(core)
  ;(globalThis as Record<string, unknown>).__wardicBench = async (
    options: Options,
  ): Promise<Record<string, WorkloadResult>> => {
    const out: Record<string, WorkloadResult> = {}
    for (const workload of WORKLOADS) {
      if (workload.runsOn !== undefined && !workload.runsOn(core)) continue
      const times: Array<number> = []
      const starts: Array<number> = []
      const bytes: Array<number> = []
      for (let r = 0; r < options.rounds; r++) {
        const round = await runRound(core, registry, workload, options)
        if (r === 0) continue
        times.push(...round.times)
        starts.push(round.startMs)
        bytes.push(...round.bytes)
      }
      const result: { -readonly [K in keyof WorkloadResult]: WorkloadResult[K] } = {
        runs: runsOf(workload, options),
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
