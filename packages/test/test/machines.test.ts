import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { motionKeyframesAt, motionRunAt, motionRunDone, type RunOptions } from "./motion-oracle.ts"
import { describe, expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"

/**
 * The `Machine` module's Primitives (ADR-0027, ADR-0028):
 * - **the composites against Motion's timing** (#226, ADR-0028 *Amendment (#226)*): `animate` and
 *   `keyframes` against `motion-oracle.ts` (Motion's `JSAnimation` iteration math and keyframes
 *   generator) at each Frame's frame time, value and `done`; `animateValues` against `animate`'s
 *   progress through the same blenders, and `springBlend` against `springValues`' progress. The
 *   generic combinators' seams are `combinators.test.ts`';
 * - **driver parity:** every constructor through `Machine.toStream` against `Machine.run` on the
 *   Frame loop, Frame for Frame.
 *
 * The dts are uneven on purpose: 60, 30 and 120 Hz frames, a repeated timestamp (0), a 0.25 s
 * stall, and a 0.6 s one above `MAX_DT`, which every constructor clamps (#78).
 */
const DTS: ReadonlyArray<number> = [
  1 / 60,
  1 / 30,
  1 / 120,
  0,
  1 / 60,
  0.25,
  0.6,
  1 / 60,
  ...Array.from({ length: 140 }, (_, i) => Bool.match(i % 3 === 0, { onTrue: () => 1 / 30, onFalse: () => 1 / 60 })),
]

/** Run `a` and `b` side by side on one pushable Clock for `DTS`, and collect each one's Frames. */
const sideBySide = <A, B>(a: Stream.Stream<A, never, any>, b: Stream.Stream<B, never, any>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const layer = Layer.merge(clock.layer, InterpolatorRegistry.layer)
    const collect = <X>(stream: Stream.Stream<X, never, any>) =>
      Stream.runCollect(stream.pipe(Stream.take(DTS.length))).pipe(
        Effect.provide(layer),
        Effect.forkChild({ startImmediately: true }),
      )
    const fa = yield* collect(a)
    const fb = yield* collect(b)
    for (const dt of DTS) yield* clock.advance(dt)
    const xs = yield* Fiber.join(fa)
    const ys = yield* Fiber.join(fb)
    return [Array.from(xs), Array.from(ys)] as const
  })

/** The oracle's Frames and the machine's are equal, and there are enough of them to mean it. */
const expectSame = <A>(expected: ReadonlyArray<A>, actual: ReadonlyArray<A>, atLeast: number) => {
  expect(actual.map(withoutIndex)).toEqual(expected.map(withoutIndex))
  expect(expected.length).toBeGreaterThanOrEqual(atLeast)
}

/** A Frame without `springValues`' records by index (#663), which the oracle's Frames don't have. */
const withoutIndex = (frame: unknown): unknown => {
  if (typeof frame !== "object" || frame === null) return frame
  return Object.fromEntries(Object.entries(frame).filter(([field]) => !BY_INDEX.has(field)))
}

const settledLast = (frames: ReadonlyArray<Frame.Frame<unknown>>) => frames.at(-1)?.done

/**
 * `springValues`' records by index (#663), which `spring-values-records.test.ts` checks: the oracle's
 * Frames, one spring per key, have none.
 */
const BY_INDEX = new Set(["keys", "positions", "velocities"])

/** A Frame a sink keeps, copied with its records (`value`, `velocity`): `springValues` rewrites one per run. */
const kept = <F extends Frame.Frame<unknown>>(frame: F): F => {
  const copy: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(frame)) {
    if (BY_INDEX.has(field)) continue
    if (typeof value === "object" && value !== null) copy[field] = { ...value }
    else copy[field] = value
  }
  return copy as F
}

// --- The oracle: Motion's timing (#226) -------------------------------------------------------

/** A machine stepped through `DTS` by hand: each Frame, and its frame time (each dt clamped at `MAX_DT`, as the machine counts it). */
const stepped = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>) => {
  const step = machine.start()
  const frames: Array<{ readonly frame: F; readonly time: number }> = []
  let time = 0
  for (const dt of DTS) {
    time += Math.min(dt, Machine.MAX_DT)
    const frame = step(dt)
    frames.push({ frame, time })
    if (frame.done) break
  }
  return frames
}

/**
 * Each key's blend from `from` to `to`, built through the registry as `animateValues` and
 * `springBlend` build it: the Environment's Key rule for the key when one takes it (ADR-0035), else
 * by value. The Test Environment's registry has no Key rules, so a `display` or `visibility` pair is
 * a Discrete pair here; the DOM's rules are tested in `@wardic/dom`'s `key-rules.node.test.ts`.
 */
const blenderOf = (from: Values.Values, to: Values.Values) =>
  Effect.gen(function* () {
    const registry = yield* InterpolatorRegistry.InterpolatorRegistry
    const keys: Array<readonly [string, (t: number, done: boolean) => number | string]> = []
    for (const [key, b] of Object.entries(to)) {
      const a = from[key] ?? b
      const rule = registry.keyBlendOf(key, a, b)
      if (Option.isSome(rule)) {
        keys.push([key, yield* rule.value])
        continue
      }
      const blend = yield* registry.resolve(a, b)
      keys.push([key, (t) => blend(t)])
    }
    return (t: number, done: boolean): Frame.Frame<Values.Values> => ({
      value: Object.fromEntries(keys.map(([key, blend]) => [key, blend(t, done)])),
      done,
    })
  })

/**
 * `springValues` as it stepped before #111 stepped it in place: one spring per key
 * (`Machine.spring`'s step, `Spring.step` with `dt` clamped), each from its own start (its
 * `from`, else `options.from`, else 0, and the same for `velocity`), every key stepped on every
 * tick, settling once every key is at rest.
 */
const springValuesOracle = (
  target: Record<string, number>,
  options: Machine.SpringOptions,
  from: Record<string, number>,
  velocity: Record<string, number>,
): Machine.Machine<Frame.MultiPhysics> =>
  Machine.make({
    settles: true,
    span: { name: "oracle.springValues", attributes: {} },
    start: () => {
      const keys = Object.keys(target)
      const steps = keys.map((key) =>
        Machine.spring(target[key]!, {
          ...options,
          from: from[key] ?? options.from ?? 0,
          velocity: velocity[key] ?? options.velocity ?? 0,
        }).start(),
      )
      return (dt) => {
        const frames = steps.map((step) => step(dt))
        return {
          value: Object.fromEntries(keys.map((key, i) => [key, frames[i]!.value])),
          velocity: Object.fromEntries(keys.map((key, i) => [key, frames[i]!.velocity])),
          done: frames.every((frame) => frame.done),
        }
      }
    },
  })

describe("springValues against one spring per key (#111)", () => {
  // Tight thresholds, so a case runs on past the stalls (frames 6 and 7): Motion's (#344) land
  // most of these right after them. The last case keeps the defaults: each key's own, by its distance.
  const TIGHT = { restDelta: 0.01, restSpeed: 0.01 } as const
  const cases = [
    [
      "four keys, from a velocity, through both stalls",
      { x: 120, y: -40, scale: 1.2, opacity: 1 },
      TIGHT,
      { x: 0, y: 0, scale: 1, opacity: 0 },
      { x: 300 },
      10,
    ],
    [
      "options' from and velocity as the keys' defaults, a mass and a delay",
      { x: 100, y: 50 },
      { stiffness: 300, damping: 18, mass: 1.5, from: -20, velocity: 40, delay: 0.1 },
      { y: 10 },
      {},
      10,
    ],
    ["a key at its target from the start, stepped on with the others", { x: 10, y: 0 }, TIGHT, { x: 0, y: 0 }, {}, 10],
    ["Motion's thresholds by each key's own distance (#344): a pixel key beside an opacity", { x: 300, opacity: 1 }, {}, { x: 0, opacity: 0 }, {}, 5],
  ] as const
  for (const [name, target, options, from, velocity, atLeast] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(
          Machine.toStream(springValuesOracle(target, options, from, velocity)),
          Machine.toStream(Machine.springValues(target, options, { from, velocity })),
        )
        expectSame(s, m, atLeast)
        expect(settledLast(s)).toBe(true)
      }))
  }
})

/**
 * Each combinator over `springValues`, whose run rewrites one Frame (#111), against the same
 * combinator over the oracle, whose Frames are fresh: a combinator that kept a Frame its leaf goes
 * on rewriting would emit a later tick's values. Through `toStream`, then through both drivers.
 */
describe("the combinators over springValues' rewritten Frame (#111)", () => {
  type Build = (
    target: Record<string, number>,
    options: Machine.SpringOptions,
    from: Record<string, number>,
    velocity: Record<string, number>,
  ) => Machine.Machine<Frame.MultiPhysics>
  // Tight thresholds, so it runs on past the stalls (#344's land it right after them).
  const a = (build: Build) => build({ x: 100, y: -40 }, { stiffness: 260, damping: 20, restDelta: 0.01, restSpeed: 0.01 }, { x: 0, y: 0 }, { x: 200 })
  const b = (build: Build) => build({ x: -30, y: 0 }, {}, { x: 100, y: -40 }, {})
  const cases: ReadonlyArray<readonly [string, (build: Build) => Machine.Machine<Frame.Frame<unknown>>]> = [
    ["concat: the seam's re-stamp", (build) => Machine.concat(a(build), b(build))],
    ["delay: the held start Frame", (build) => a(build).pipe(Machine.delay(0.3))],
    ["holdAfter: the held settled Frame", (build) => Machine.concat(a(build).pipe(Machine.holdAfter(0.3)), b(build))],
    ["map: a progress, as springBlend's", (build) => a(build).pipe(Machine.map((frame) => ({ value: frame.value.x! / 100, done: frame.done })))],
    ["forever: each restart", (build) => Machine.forever(a(build))],
  ]
  // `springValues` takes its start in a bag (#618, F3): a builder as the oracle's, positional.
  const springValuesBuild: Build = (target, options, from, velocity) => Machine.springValues(target, options, { from, velocity })
  for (const [name, combine] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(Machine.toStream(combine(springValuesOracle)), Machine.toStream(combine(springValuesBuild)))
        expectSame(s, m, 10)
        const [viaStream, viaLoop] = yield* bothDrivers(() => Effect.succeed(combine(springValuesBuild)))
        expectSame(viaStream, viaLoop, 10)
      }))
  }
})

describe("the composites against Motion's timing (#226)", () => {
  /** An asymmetric easing, so `"reverse"` and `"mirror"` differ. */
  const CUBE = (t: number) => t * t * t
  const animateCases: ReadonlyArray<readonly [string, RunOptions, boolean]> = [
    ["one run", { duration: 0.3, delay: 0, repeat: 0, repeatDelay: 0, repeatType: "loop", ease: CUBE }, false],
    ["repeat 2, a delay held once (#77)", { duration: 0.3, delay: 0.05, repeat: 2, repeatDelay: 0, repeatType: "loop", ease: CUBE }, false],
    ["repeat 3, reverse, swapped endpoints", { duration: 0.25, delay: 0, repeat: 3, repeatDelay: 0, repeatType: "reverse", ease: CUBE }, true],
    ["repeat 3, mirror, a repeatDelay", { duration: 0.25, delay: 0, repeat: 3, repeatDelay: 0.07, repeatType: "mirror", ease: CUBE }, false],
    ["repeat 2, reverse, a repeatDelay and a delay", { duration: 0.2, delay: 0.05, repeat: 2, repeatDelay: 0.07, repeatType: "reverse", ease: CUBE }, false],
    ["repeat Infinity", { duration: 0.2, delay: 0, repeat: Infinity, repeatDelay: 0, repeatType: "loop", ease: CUBE }, false],
    ["repeat Infinity, mirror, a delay held once (#77)", { duration: 0.2, delay: 0.05, repeat: Infinity, repeatDelay: 0, repeatType: "mirror", ease: CUBE }, false],
    ["repeat Infinity, reverse, a repeatDelay", { duration: 0.12, delay: 0, repeat: Infinity, repeatDelay: 0.05, repeatType: "reverse", ease: CUBE }, false],
    ["a delay of 0.3, past the 0.25 s stall", { duration: 0.4, delay: 0.3, repeat: 0, repeatDelay: 0, repeatType: "loop", ease: CUBE }, false],
  ]
  for (const [name, o, reverse] of animateCases) {
    it(`animate: ${name}`, () => {
      const frames = stepped(Machine.animate(-5, 20, { ...o, reverse }))
      const [a, b] = Bool.match(reverse, { onTrue: () => [20, -5] as const, onFalse: () => [-5, 20] as const })
      expect(frames.length).toBeGreaterThanOrEqual(5)
      for (const [i, { frame, time }] of frames.entries()) {
        expect(frame.value, `frame ${i}, at ${time}`).toBeCloseTo(motionRunAt(time, a, b, o), 9)
        expect(frame.done, `frame ${i} done`).toBe(motionRunDone(time, o))
      }
    })
  }

  const keyframesCases = [
    ["four stops, a delay held once (#77)", [0, 10, 5, 20], 0.6, 0.05],
    ["five stops", [10, -20, 40, 0, 5], 0.9, 0],
  ] as const
  for (const [name, stops, duration, delay] of keyframesCases) {
    it(`keyframes: ${name}`, () => {
      const frames = stepped(Machine.keyframes(stops, { duration, delay, ease: CUBE }))
      expect(frames.length).toBeGreaterThanOrEqual(5)
      for (const [i, { frame, time }] of frames.entries()) {
        expect(frame.value, `frame ${i}, at ${time}`).toBeCloseTo(motionKeyframesAt(time, stops, duration, delay, CUBE), 9)
        expect(frame.done, `frame ${i} done`).toBe(time - delay >= duration)
      }
    })
  }

  it("keyframes: one stop, or none, holds still for its duration", () => {
    for (const stops of [[3], []]) {
      const frames = stepped(Machine.keyframes(stops, { duration: 0.2 }))
      expect(frames.every(({ frame }) => frame.value === (stops[0] ?? 0))).toBe(true)
      expect(frames.at(-1)?.frame.done).toBe(true)
      expect(frames.at(-1)?.time).toBeGreaterThanOrEqual(0.2)
    }
  })

  const FROM = { x: 0, filter: "blur(2px) brightness(0.5)", width: "10px", "pointer-events": "auto", visibility: "visible" }
  const TO = { x: 40, filter: "blur(8px) brightness(1)", width: "200px", "pointer-events": "none", visibility: "hidden" }

  it.effect("animateValues: strings, a Discrete pair and visibility, repeat 1 mirrored, a delay: animate's progress, blended", () =>
    Effect.gen(function* () {
      const options = { duration: 0.4, repeat: 1, repeatType: "mirror" as const, delay: 0.05, ease: Easing.easeInOutCubic }
      const blend = yield* blenderOf(FROM, TO).pipe(Effect.provide(InterpolatorRegistry.layer))
      const machine = yield* Machine.animateValues(FROM, TO, options).pipe(Effect.provide(InterpolatorRegistry.layer))
      const progress = Machine.toStream(Machine.animate(0, 1, options)).pipe(Stream.map((frame) => blend(frame.value, frame.done)))
      const [s, m] = yield* sideBySide(progress, Machine.toStream(machine))
      expectSame(s, m, 5)
      expect(settledLast(s)).toBe(true)
    }))

  it.effect("springBlend: strings, a Discrete pair and visibility, with a delay", () =>
    Effect.gen(function* () {
      const options = { stiffness: 220, damping: 14, delay: 0.05 }
      const blend = yield* blenderOf(FROM, TO).pipe(Effect.provide(InterpolatorRegistry.layer))
      const machine = yield* Machine.springBlend(FROM, TO, options).pipe(Effect.provide(InterpolatorRegistry.layer))
      const oracle = Machine.toStream(Machine.springValues({ progress: 100 }, options, { from: { progress: 0 }, velocity: { progress: 0 } })).pipe(
        Stream.map((frame) => blend(frame.value.progress! / 100, frame.done)),
      )
      const [s, m] = yield* sideBySide(oracle, Machine.toStream(machine))
      expectSame(s, m, 10)
      expect(settledLast(s)).toBe(true)
    }))
})

/**
 * A machine through both drivers on one pushable Clock: `Machine.toStream`, and `Machine.run` on
 * the Frame loop. Each collects up to `DTS.length` Frames; a run that never settles is
 * interrupted at the end. `build` is called once per driver, so a machine that closes over state
 * of its own (a moving target) gives each driver the same. The loop's sink keeps each Frame, so it
 * copies it: a Frame handed to a sink is the run's until the next tick (ADR-0030, decision 11).
 */
const bothDrivers = <F extends Frame.Frame<unknown>>(build: () => Effect.Effect<Machine.Machine<F>, never, InterpolatorRegistry.InterpolatorRegistry>) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    const layer = FrameLoop.layer.pipe(Layer.provideMerge(Layer.merge(clock.layer, InterpolatorRegistry.layer)))
    return yield* Effect.gen(function* () {
      const viaStream = yield* Stream.runCollect(Machine.toStream(yield* build()).pipe(Stream.take(DTS.length))).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      const viaLoop: Array<F> = []
      const run = yield* (yield* build()).pipe(
        Machine.run((frame) => {
          if (viaLoop.length < DTS.length) viaLoop.push(kept(frame))
          return undefined
        }),
        Effect.forkChild({ startImmediately: true }),
      )
      for (const dt of DTS) yield* clock.advance(dt)
      const fromStream = Array.from(yield* Fiber.join(viaStream))
      yield* Fiber.interrupt(run)
      return [fromStream, viaLoop] as const
    }).pipe(Effect.provide(layer))
  })

describe("every constructor through both drivers", () => {
  const OPTIONS = { duration: 0.3, repeat: 2, repeatType: "mirror" as const, delay: 0.05, ease: Easing.easeInOutCubic }
  const FROM = { x: 0, filter: "blur(2px) brightness(0.5)", width: "10px", "pointer-events": "auto", visibility: "visible" }
  const TO = { x: 40, filter: "blur(8px) brightness(1)", width: "200px", "pointer-events": "none", visibility: "hidden" }
  const cases: ReadonlyArray<
    readonly [string, () => Effect.Effect<Machine.Machine<Frame.Frame<unknown>>, never, InterpolatorRegistry.InterpolatorRegistry>]
  > = [
    ["tween, with an easing and a delay", () => Effect.succeed(Machine.tween(0, 10, OPTIONS))],
    ["spring", () => Effect.succeed(Machine.spring(100, { stiffness: 300, damping: 12, from: -20, velocity: 40 }))],
    [
      "chase, following a moving target",
      () => {
        let target = 0
        return Effect.succeed(Machine.chase(() => (target += 0.5)))
      },
    ],
    ["decay", () => Effect.succeed(Machine.decay(0, 500, { friction: 4 }))],
    ["decayVec", () => Effect.succeed(Machine.decayVec({ x: 0, y: 5 }, { x: 300, y: -200 }, {}))],
    [
      "springValues, from a velocity",
      () => Effect.succeed(Machine.springValues({ x: 0, y: 10 }, { stiffness: 200 }, { from: { x: 100, y: -20 }, velocity: { x: 50 } })),
    ],
    [
      "springValues, options' from and velocity, a delay",
      () => Effect.succeed(Machine.springValues({ x: 100, y: 50 }, { stiffness: 300, from: -20, velocity: 40, delay: 0.1 }, { from: { y: 10 } })),
    ],
    ["animate, repeat 2, mirror, a delay", () => Effect.succeed(Machine.animate(-5, 20, OPTIONS))],
    ["animate, repeat Infinity", () => Effect.succeed(Machine.animate(-5, 20, { duration: 0.2, repeat: Infinity }))],
    [
      "animate, repeat 3, reverse, a repeatDelay and a delay",
      () => Effect.succeed(Machine.animate(-5, 20, { duration: 0.2, repeat: 3, repeatType: "reverse", repeatDelay: 0.07, delay: 0.05 })),
    ],
    ["animate, repeat Infinity with a repeatDelay", () => Effect.succeed(Machine.animate(-5, 20, { duration: 0.2, repeat: Infinity, repeatDelay: 0.1 }))],
    ["keyframes", () => Effect.succeed(Machine.keyframes([0, 10, 5, 20], { duration: 0.6, delay: 0.05 }))],
    ["animateValues", () => Machine.animateValues(FROM, TO, OPTIONS)],
    ["springBlend", () => Machine.springBlend(FROM, TO, { delay: 0.05 })],
  ]
  for (const [name, build] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* bothDrivers(build)
        expectSame(s, m, 5)
      }))
  }
})

describe("every combinator through both drivers", () => {
  const tween = (from: number, to: number) => Machine.tween(from, to, { duration: 0.2, ease: Easing.easeInOutCubic })
  const cases: ReadonlyArray<readonly [string, () => Effect.Effect<Machine.Machine<Frame.Frame<unknown>>>]> = [
    ["map", () => Effect.succeed(tween(0, 10).pipe(Machine.map((frame) => ({ value: frame.value * 3, done: frame.done }))))],
    ["concat", () => Effect.succeed(tween(0, 10).pipe(Machine.concat(Machine.spring(-10, { stiffness: 300 }))))],
    ["concatAll", () => Effect.succeed(Machine.concatAll([tween(0, 10), tween(10, -4), Machine.decay(-4, 80, {})]))],
    ["forever", () => Effect.succeed(Machine.forever(Machine.concatAll([tween(0, 10), tween(10, 0)])))],
    ["delay, around a spring", () => Effect.succeed(Machine.spring(100).pipe(Machine.delay(0.3)))],
    ["clampDt", () => Effect.succeed(tween(0, 10).pipe(Machine.clampDt(0.02)))],
    ["holdAfter, across the 0.25 s and 0.6 s stalls", () => Effect.succeed(Machine.concatAll([tween(0, 10).pipe(Machine.holdAfter(0.3)), tween(10, 0)]))],
    ["withSpan", () => Effect.succeed(tween(0, 10).pipe(Machine.withSpan("app.tween", { attributes: { a: 1 } })))],
  ]
  for (const [name, build] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* bothDrivers(build)
        expectSame(s, m, 5)
      }))
  }
})

/**
 * `Machine.delay` against the steppers' own `delay` (ADR-0028, decision 9): the hold, then the
 * time left over to an undelayed step, where the stepper subtracts the delay from its elapsed time
 * on every step. On these dts the sums round differently, so a Frame after the hold can differ in
 * its last bit, and only there: every `done` and every Frame count are the same.
 */
describe("Machine.delay against the steppers' delay", () => {
  const cases: ReadonlyArray<readonly [string, Machine.Machine<Frame.Frame<number>>, Machine.Machine<Frame.Frame<number>>]> = [
    ...[0.05, 0.1, 0.3].map((delay) =>
      [
        `tween −5 → 20, 2 s, delay ${delay}`,
        Machine.tween(-5, 20, { duration: 2, delay }),
        Machine.tween(-5, 20, { duration: 2 }).pipe(Machine.delay(delay)),
      ] as const),
    [
      "tween 0 → 1, 0.2 s, delay 0.05",
      Machine.tween(0, 1, { duration: 0.2, delay: 0.05 }),
      Machine.tween(0, 1, { duration: 0.2 }).pipe(Machine.delay(0.05)),
    ],
    ...[0.05, 0.3].map((delay) =>
      [
        `spring 0 → 100, delay ${delay}`,
        Machine.spring(100, { delay }),
        Machine.spring(100).pipe(Machine.delay(delay)),
      ] as const),
  ]
  for (const [name, stepper, held] of cases) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const [s, m] = yield* sideBySide(Machine.toStream(stepper), Machine.toStream(held))
        expect(m.length).toBe(s.length)
        expect(s.length).toBeGreaterThanOrEqual(5)
        expect(m.map((frame) => frame.done)).toEqual(s.map((frame) => frame.done))
        for (const [i, frame] of m.entries()) expect(Math.abs(frame.value - s[i]!.value)).toBeLessThan(1e-12)
      }))
  }
})
