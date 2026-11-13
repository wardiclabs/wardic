// Live values (#130, ADR-0043): core's helpers that derive one from another, over `effect/reactivity`
// Atoms. `transform` maps ranges through the InterpolatorRegistry, or an app's `mixer` (#440); `spring`
// follows its source on the Frame loop, with a run only while it moves.
//
// #440, against Motion 14.6's own `transform`, measured:
// - TR7: a `mixer` blends each stretch: made once per stretch, from its two outputs, read through its
//   `ease`; outputs of any type.
// - TR8: a descending range maps as Motion's, at any length.
// - TR9: with `ease`, a descending range's curves run toward the higher input, and a list goes to its
//   stretches back to front, as Motion's.
// - TR10: Motion's edge cases: two equal outputs, given as they are with no mixer made; a stretch of no
//   length, first or inside, clamped or not.
//
// #441, `follow` against Motion 14.6's `followValue`, measured at exact 20 ms frames:
// - FV1: no `type` is a spring of Motion's 100 / 10 / 1, at rest within 0.001; `spring` is the same; a
//   spring given some physics takes Motion's for the rest; one set by time takes none.
// - FV2: `type: "tween"` is 0.3 s `easeInOut`; a `duration` is in seconds (Motion's follower's are
//   milliseconds).
// - FV3: a change mid-tween starts it again from where it's reached; changes in one frame start it once.
// - FV4: a `delay` holds it at every change, keeping a spring's velocity: a debounce.
// - FV5: an inertia glides again at each change, its target unread; none from rest with no velocity.
// - FV6: a `velocity` given steers every change.
// - FV7: a change to where it is starts nothing; a `jump` ends a tween; the skips jump a tween.
//
// #443, `eachFrame` (Motion's `useAnimationFrame`):
// - AF1: time 0 at its first frame, then the total of each tick's dt, unclamped; delta the tick's dt in ms.
// - AF2: delta held to 1–40 ms, as Motion's frame loop holds it; time not.
// - AF3: closing its Scope ends the run: no frame after.
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as Machine from "@wardic/core/Machine"
import type * as ScrollSource from "@wardic/core/ScrollSource"
import { TestClock, TestProbe } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"

const F = 1 / 60

describe("LiveValue.transform: ranges mapped through the registry (#130)", () => {
  const layer = Layer.merge(InterpolatorRegistry.layer, AtomRegistry.layer)

  /** `transform`'s value at each of `inputs`, the source set to each in turn. */
  const at = (input: ReadonlyArray<number>, output: ReadonlyArray<number | string>, inputs: ReadonlyArray<number>, options?: LiveValue.TransformOptions) =>
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry
      const source = Atom.make(0)
      const out = yield* LiveValue.transform(source, input, output, options)
      return inputs.map((v) => {
        registry.set(source, v)
        return registry.get(out)
      })
    }).pipe(Effect.provide(layer))

  it.effect("TR1: an input between two stops gives their outputs blended by its progress; outside, the ends hold", () =>
    Effect.gen(function* () {
      expect(yield* at([-150, 0, 150], [0, 1, 0], [-300, -150, -75, 0, 75, 150, 300])).toEqual([0, 0, 0.5, 1, 0.5, 0, 0])
    }))

  it.effect("TR2: clamp: false carries the first and last stretches on", () =>
    Effect.gen(function* () {
      expect(yield* at([-150, 0, 150], [0, 1, 0], [-300, 300], { clamp: false })).toEqual([-1, -1])
    }))

  it.effect("TR3: a unit string blends as animate's does", () =>
    Effect.gen(function* () {
      expect(yield* at([0, 1], ["0px", "100px"], [0.25, 0.5])).toEqual(["25px", "50px"])
    }))

  it.effect("TR4: a subscriber hears each change, mapped", () =>
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry
      const source = Atom.make(0)
      const out = yield* LiveValue.transform(source, [0, 100], [1, 0])
      const heard: Array<number> = []
      registry.subscribe(out, (v) => void heard.push(v), { immediate: true })
      registry.set(source, 50)
      registry.set(source, 100)
      expect(heard).toEqual([1, 0.5, 0])
    }).pipe(Effect.provide(layer)))

  it.effect("TR5: input and output of different lengths, or none, is a defect; one stop gives its output (#440, Motion's)", () =>
    Effect.gen(function* () {
      const source = Atom.make(0)
      const lengths = yield* Effect.exit(LiveValue.transform(source, [0, 1, 2], [0, 1]))
      const none = yield* Effect.exit(LiveValue.transform(source, [], []))
      expect(Exit.isFailure(lengths) && Exit.hasDies(lengths)).toBe(true)
      expect(Exit.isFailure(none) && Exit.hasDies(none)).toBe(true)
      expect(yield* at([5], [9], [-1, 5, 20]), "one stop").toEqual([9, 9, 9])
    }).pipe(Effect.provide(layer)))

  it.effect("TR6: interpolate is transform's mapping as a plain function, colours blended by the registry", () =>
    Effect.gen(function* () {
      const map = yield* LiveValue.interpolate([0, 100], [0, 1])
      expect([map(-50), map(25), map(150)]).toEqual([0, 0.25, 1])
      const unclamped = yield* LiveValue.interpolate([0, 100], [0, 1], { clamp: false })
      expect(unclamped(150)).toBe(1.5)
      const bad = yield* Effect.exit(LiveValue.interpolate([0, 1], [0]))
      expect(Exit.isFailure(bad) && Exit.hasDies(bad)).toBe(true)
    }).pipe(Effect.provide(layer)))

  it.effect("TR7: a mixer blends each stretch, made once per stretch and read through its ease; any outputs", () =>
    Effect.gen(function* () {
      const made: Array<string> = []
      const mixPoints = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
        made.push(`${a}>${b}`)
        return (t: number): ReadonlyArray<number> => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t]
      }
      const map = yield* LiveValue.interpolate([0, 10, 20], [[0, 0], [100, 50], [100, 100]], { mixer: mixPoints })
      expect(made, "once per stretch, when built").toEqual(["0,0>100,50", "100,50>100,100"])
      expect([map(5), map(15), map(30)]).toEqual([[50, 25], [100, 75], [100, 100]])
      expect(made, "not again as it maps").toHaveLength(2)
      const eased = yield* LiveValue.interpolate([0, 1], [[0, 0], [100, 100]], { mixer: mixPoints, ease: "easeIn" })
      expect(eased(0.5)[0], "its stretch's ease first").toBeCloseTo(100 * Easing.easeIn(0.5), 6)
    }).pipe(Effect.provide(layer)))

  it.effect("TR8: a descending range maps as Motion's, at any length", () =>
    Effect.gen(function* () {
      expect(yield* at([100, 50, 0], [0, 1, 0], [100, 75, 50, 25, 0])).toEqual([0, 0.5, 1, 0.5, 0])
      expect(yield* at([100, 0], [0, 1], [150, 100, 75, 0, -50]), "clamped").toEqual([0, 0, 0.25, 1, 1])
      expect(yield* at([100, 0], [0, 1], [150, -50], { clamp: false }), "unclamped").toEqual([-0.5, 1.5])
    }))

  it.effect("TR9: with ease, a descending range's curves run toward the higher input, a list back to front", () =>
    Effect.gen(function* () {
      const eased = yield* at([1, 0], [0, 100], [0.75, 0.5, 0.25], { ease: "easeIn" })
      // Motion 14.6: 37.81, 68.46, 90.65.
      expect(eased.map((v) => Math.round((v as number) * 100) / 100)).toEqual([37.81, 68.46, 90.65])
      const listed = yield* at([100, 50, 0], [0, 100, 200], [75, 25], { ease: ["easeIn", "linear"] })
      // Motion 14.6: 50 (linear) and 168.46 (easeIn).
      expect(listed.map((v) => Math.round((v as number) * 100) / 100)).toEqual([50, 168.46])
    }))

  it.effect("TR10: Motion's edge cases: equal outputs, a stretch of no length", () =>
    Effect.gen(function* () {
      expect(yield* at([0, 1], [4, 4], [-1, 0.5, 2]), "two equal outputs").toEqual([4, 4, 4])
      expect(yield* at([0, 0, 1], [0, 10, 20], [-1, 0, 0.5, 1]), "the first of no length, clamped").toEqual([10, 10, 15, 20])
      expect(yield* at([0, 0, 1], [0, 10, 20], [-1, 0, 0.5, 2], { clamp: false }), "unclamped").toEqual([0, 10, 15, 30])
      expect(yield* at([0, 1, 1, 2], [0, 10, 20, 30], [0.5, 1, 1.5]), "one inside").toEqual([5, 20, 25])
      expect(yield* at([0, 0], [0, 1], [-1, 0, 1]), "the only one, clamped").toEqual([1, 1, 1])
      expect(yield* at([0, 0], [0, 1], [-1, 0, 1], { clamp: false }), "unclamped").toEqual([0, 1, 1])
      // Two equal outputs aren't mixed: the output itself, everywhere.
      const same = { at: "rest" }
      let made = 0
      const counting = (a: { readonly at: string }, b: { readonly at: string }) => {
        made++
        return (t: number) => ({ at: `${a.at}>${b.at}@${t}` })
      }
      const equal = yield* LiveValue.interpolate([0, 1], [same, same], { mixer: counting }).pipe(Effect.provide(layer))
      expect([equal(0), equal(0.5), equal(2)].every((v) => v === same), "the output itself").toBe(true)
      expect(made, "no mixer made").toBe(0)
    }))
})

type LoopShape = Context.Service.Shape<typeof FrameLoop.FrameLoop>

/** A pushable Clock, the real Frame loop wrapped to count its live runs, and a registry. */
const harness = () =>
  Effect.gen(function* () {
    const clock = yield* TestClock.pushable()
    let live = 0
    const count = (go: LoopShape["run"]): LoopShape["run"] =>
      ((machine: Machine.Machine<Frame.Frame<unknown>>, sink: FrameLoop.Sink<Frame.Frame<unknown>>, options?: Machine.RunOptions) =>
        Effect.suspend(() => {
          live++
          return go(machine, sink, options as Machine.RunOptions)
        }).pipe(Effect.ensuring(Effect.sync(() => void live--)))) as unknown as LoopShape["run"]
    const loop = Layer.effect(FrameLoop.FrameLoop)(FrameLoop.FrameLoop.useSync((l) => ({ ...l, run: count(l.run), runLast: count(l.runLast) }))).pipe(
      Layer.provide(FrameLoop.layer),
    )
    const layer = loop.pipe(Layer.provideMerge(Layer.merge(clock.layer, AtomRegistry.layer)))
    return { clock, layer, live: () => live }
  })

/** `n` frames of 1/60 s, each `out`'s value after it. */
const frames = (clock: { readonly advance: (dt?: number) => Effect.Effect<void> }, registry: Context.Service.Shape<typeof AtomRegistry.AtomRegistry>, out: Atom.Atom<number>, n: number) =>
  Effect.gen(function* () {
    const values: Array<number> = []
    for (let i = 0; i < n; i++) {
      yield* clock.advance(F)
      values.push(registry.get(out))
    }
    return values
  })

describe("LiveValue.spring: follows its source on the Frame loop, idle at rest (#130)", () => {
  it.effect("SP1: it starts where its source is, and nothing runs until the source moves", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(40)
        const out = yield* LiveValue.spring(source)
        expect(registry.get(out)).toBe(40)
        expect(yield* frames(h.clock, registry, out, 5)).toEqual([40, 40, 40, 40, 40])
        expect(h.live()).toBe(0)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("SP2: a change starts a run that follows from rest, Frame for Frame Machine.spring's, and ends at rest on the source", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.spring(source, { stiffness: 200, damping: 20 })
        registry.set(source, 100)
        expect(h.live()).toBe(1)
        const values = yield* frames(h.clock, registry, out, 240)
        const step = Machine.spring(100, { stiffness: 200, damping: 20 }).start()
        const expected = values.map(() => step(F).value)
        for (const [i, v] of values.slice(0, 30).entries()) expect(v, `frame ${i}`).toBeCloseTo(expected[i]!, 9)
        expect(values.at(-1)).toBe(100)
        expect(h.live(), "the run ended at rest").toBe(0)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("SP3: a change mid-flight keeps the run it's on: it chases the new value with its velocity, no restart", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.spring(source)
        registry.set(source, 100)
        const first = yield* frames(h.clock, registry, out, 10)
        registry.set(source, 50)
        expect(h.live(), "still one run").toBe(1)
        const after = yield* frames(h.clock, registry, out, 10)
        // Machine.chase toward a target that moves at the same frame, on Motion's follower's spring (#441).
        let target = 100
        const step = Machine.chase(() => target, { stiffness: 100, damping: 10, mass: 1, restDelta: 0.001, restSpeed: 0.01 }).start()
        const expected = [...first, ...after].map((_, i) => {
          if (i === 10) target = 50
          return step(F).value
        })
        for (const [i, v] of [...first, ...after].entries()) expect(v, `frame ${i}`).toBeCloseTo(expected[i]!, 9)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("SP4: after a rest, the next change starts a new run from where it rests", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.spring(source)
        registry.set(source, 10)
        yield* frames(h.clock, registry, out, 240)
        expect([registry.get(out), h.live()]).toEqual([10, 0])
        registry.set(source, 20)
        expect(h.live()).toBe(1)
        const values = yield* frames(h.clock, registry, out, 240)
        expect(values[0]!).toBeGreaterThan(10)
        expect([values.at(-1), h.live()]).toEqual([20, 0])
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("SP5: closing its Scope ends the run and the subscription", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const scope = yield* Scope.make()
        const out = yield* LiveValue.spring(source).pipe(Scope.provide(scope))
        // A reader holds it, as a binding's does: after the Scope it's held only while subscribed.
        registry.subscribe(out, () => {})
        registry.set(source, 100)
        yield* frames(h.clock, registry, out, 5)
        const at = registry.get(out)
        yield* Scope.close(scope, Exit.void)
        expect(h.live()).toBe(0)
        yield* frames(h.clock, registry, out, 5)
        registry.set(source, 0)
        yield* frames(h.clock, registry, out, 5)
        expect(registry.get(out)).toBe(at)
        expect(h.live()).toBe(0)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))
})

describe("LiveValue.follow: a Follow value on any transition, as Motion's follower (#441)", () => {
  // Motion 14.6's `followValue`, measured at exact 20 ms frames (`.tmp/441/441-probe-50hz.mjs`), where
  // its whole-millisecond times are exact: the source set before each frame, the value after it, to
  // three decimals. (At 60 Hz Motion rounds each frame's time, and its values sit up to 0.4 off.)
  const F50 = 0.02
  const SLACK = 0.002

  /** `follow`'s value over `n` 20 ms frames from a source at 0, `script` setting the source before each; the live runs after each. */
  const following = (options: LiveValue.FollowOptions, script: (set: (v: number) => void, frame: number) => void, n: number) =>
    Effect.gen(function* () {
      const h = yield* harness()
      return yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.follow(source, options)
        const values: Array<number> = []
        const live: Array<number> = []
        for (let i = 0; i < n; i++) {
          script((v) => registry.set(source, v), i)
          yield* h.clock.advance(F50)
          values.push(registry.get(out))
          live.push(h.live())
        }
        return { values, live }
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    })

  /** 100 before the first frame, then 200 before frame `at + 1`. */
  const twice = (at: number) => (set: (v: number) => void, i: number) => {
    if (i === 0) set(100)
    if (i === at) set(200)
  }

  /** Each of `values` Motion's, frame by frame. */
  const likeMotion = (values: ReadonlyArray<number>, motion: ReadonlyArray<number>) => {
    expect(values.length).toBe(motion.length)
    for (const [i, m] of motion.entries()) expect(Math.abs(values[i]! - m), `frame ${i + 1}: ${values[i]} against Motion's ${m}`).toBeLessThanOrEqual(SLACK)
  }

  it.effect("FV1: no type is a spring, Motion's: 100 / 10 / 1, at rest within 0.001; spring is the same; physics given, the rest Motion's", () =>
    Effect.gen(function* () {
      const plain = yield* following({}, twice(-1), 130)
      likeMotion(plain.values, MOTION_SPRING)
      expect(plain.live.indexOf(0) + 1, "at rest at Motion's frame 117").toBe(117)
      const h = yield* harness()
      const sprung = yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.spring(source)
        registry.set(source, 100)
        const values: Array<number> = []
        for (let i = 0; i < 130; i++) {
          yield* h.clock.advance(F50)
          values.push(registry.get(out))
        }
        return values
      }).pipe(Effect.scoped, Effect.provide(h.layer))
      expect(sprung, "LiveValue.spring: the same").toEqual(plain.values)
      const stiff = yield* following({ stiffness: 300 }, twice(-1), 30)
      const step = Machine.spring(100, { stiffness: 300, damping: 10, mass: 1, restDelta: 0.001, restSpeed: 0.01 }).start()
      for (const [i, v] of stiff.values.entries()) expect(v, `stiffness 300, frame ${i + 1}: Motion's damping 10`).toBeCloseTo(step(F50).value, 9)
      const timed = yield* following({ duration: 0.5 }, twice(-1), 30)
      const timedStep = Machine.spring(100, { duration: 0.5 }).start()
      for (const [i, v] of timed.values.entries()) expect(v, `duration 0.5, frame ${i + 1}: set by time, no physics`).toBeCloseTo(timedStep(F50).value, 9)
      expect(timed.values.at(-1), "landed").toBe(100)
    }))

  it.effect("FV2: type tween is Motion's follower's 0.3 s easeInOut; a duration is in seconds", () =>
    Effect.gen(function* () {
      const plain = yield* following({ type: "tween" }, twice(-1), 16)
      likeMotion(plain.values, [
        0.865, 3.551, 8.166, 14.741, 23.177, 33.188, 44.269, 55.731, 66.812, 76.823, 85.259, 91.834, 96.449, 99.135, 100, 100
      ])
      // Motion's `duration: 500`: its follower reads milliseconds.
      const half = yield* following({ type: "tween", duration: 0.5 }, twice(-1), 26)
      likeMotion(half.values, [
        0.308, 1.252, 2.862, 5.162, 8.166, 11.879, 16.286, 21.352, 27.016, 33.188, 39.749, 46.555, 53.445, 60.251, 66.812, 72.984, 78.648, 83.714, 88.121,
        91.834, 94.838, 97.138, 98.748, 99.692, 100, 100
      ])
      expect(half.live.indexOf(0) + 1, "at rest when it lands, Motion's frame 25").toBe(25)
    }))

  it.effect("FV3: a change mid-tween starts it again from where it's reached, its full duration, no velocity; changes in one frame, once", () =>
    Effect.gen(function* () {
      const linear = { type: "tween", duration: 0.5, ease: "linear" } as const
      const once = yield* following(linear, twice(15), 40)
      likeMotion(once.values, [
        4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 69.44, 74.88, 80.32, 85.76, 91.2, 96.64, 102.08, 107.52, 112.96, 118.4, 123.84, 129.28,
        134.72, 140.16, 145.6, 151.04, 156.48, 161.92, 167.36, 172.8, 178.24, 183.68, 189.12, 194.56
      ])
      expect(once.live.every((n) => n === 1), "one run throughout").toBe(true)
      const both = yield* following(
        linear,
        (set, i) => {
          if (i === 0) set(100)
          if (i === 10) {
            set(150)
            set(200)
          }
        },
        30,
      )
      likeMotion(both.values, [
        4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 50.24, 56.48, 62.72, 68.96, 75.2, 81.44, 87.68, 93.92, 100.16, 106.4, 112.64, 118.88, 125.12, 131.36, 137.6,
        143.84, 150.08, 156.32, 162.56
      ])
    }))

  it.effect("FV4: a delay holds it where it is at every change, a debounce: velocity kept; a source that never rests doesn't move it", () =>
    Effect.gen(function* () {
      const held = yield* following({ delay: 0.1 }, twice(15), 30)
      likeMotion(held.values, [
        0, 0, 0, 0, 0, 1.867, 6.941, 14.458, 23.704, 34.03, 44.868, 55.734, 66.229, 76.043, 84.943, 92.773, 92.773, 92.773, 92.773, 92.773, 92.773, 101.313,
        111.87, 123.698, 136.139, 148.633, 160.717, 172.031, 182.304, 191.355
      ])
      const moving = yield* following({ type: "tween", duration: 0.5, ease: "linear", delay: 0.1 }, (set, i) => set((i + 1) * 5), 30)
      expect(moving.values.every((v) => v === 0), "held at every change").toBe(true)
    }))

  it.effect("FV5: an inertia glides again from where it is at each change, its target unread; with no velocity from rest, it doesn't move", () =>
    Effect.gen(function* () {
      const glide = yield* following({ type: "inertia", velocity: 100 }, twice(15), 40)
      likeMotion(glide.values, [
        4.775, 9.264, 13.486, 17.456, 21.189, 24.699, 27.999, 31.103, 34.021, 36.765, 39.346, 41.772, 44.054, 46.199, 48.216, 50.113, 54.888, 59.378, 63.599,
        67.569, 71.302, 74.812, 78.113, 81.216, 84.135, 86.879, 89.459, 91.885, 94.167, 96.312, 98.33, 100.227, 102.01, 103.688, 105.265, 106.748, 108.142,
        109.454, 110.687, 111.846
      ])
      // Core's seconds: Motion's `timeConstant: 200` (milliseconds).
      const tuned = yield* following({ type: "inertia", velocity: 100, power: 0.5, timeConstant: 0.2 }, twice(-1), 30)
      likeMotion(tuned.values, [
        4.758, 9.063, 12.959, 16.484, 19.673, 22.559, 25.171, 27.534, 29.672, 31.606, 33.356, 34.94, 36.373, 37.67, 38.843, 39.905, 40.866, 41.735, 42.522,
        43.233, 43.877, 44.46, 44.987, 45.464, 45.896, 46.286, 46.64, 46.959, 47.249, 47.511
      ])
      const still = yield* following({ type: "inertia" }, twice(-1), 5)
      expect(still.values).toEqual([0, 0, 0, 0, 0])
      expect(still.live.at(-1), "at rest at once").toBe(0)
    }))

  it.effect("FV6: a velocity given is the one every start and every change steers with", () =>
    Effect.gen(function* () {
      const given = yield* following({ velocity: 500 }, twice(10), 30)
      likeMotion(given.values, [
        10.87, 22.99, 35.696, 48.422, 60.705, 72.182, 82.583, 91.728, 99.514, 105.907, 110.927, 121.593, 133.159, 145.043, 156.759, 167.914, 178.206, 187.42,
        195.418, 202.132, 207.552, 211.716, 214.703, 216.616, 217.583, 217.739, 217.226, 216.183, 214.744, 213.034
      ])
    }))

  it.effect("FV7: at its source already, a change starts nothing; a jump ends a tween's run; the skips jump a tween too", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.follow(source, { type: "tween", duration: 0.5 })
        registry.set(source, 100)
        yield* frames(h.clock, registry, out, 5)
        yield* LiveValue.jump(out, 70)
        expect([registry.get(out), h.live()], "a jump ends the run where it's set").toEqual([70, 0])
        registry.set(source, 70)
        expect(h.live(), "at its source already: no run").toBe(0)
        registry.set(source, 80)
        expect(h.live(), "the next change runs from there").toBe(1)
        const [next] = yield* frames(h.clock, registry, out, 1)
        expect(next!).toBeGreaterThan(70)
        expect(next!).toBeLessThan(71)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
      const first = yield* following({ type: "tween", skipInitialAnimation: true }, twice(5), 6)
      expect(first.values[0], "the first change lands at once").toBe(100)
      expect(first.values[5], "the next one tweens").toBeLessThan(102)
      const all = yield* following({ type: "tween", skipAnimations: true }, twice(5), 6)
      expect([all.values[0], all.values[5], all.live.at(-1)], "every change lands at once").toEqual([100, 200, 0])
    }))
})

/** Motion's `useSpring(x)` from 0 to 100 at 20 ms frames (FV1): 100 / 10 / 1, at rest within 0.001 at frame 117. */
const MOTION_SPRING = [
  1.867, 6.941, 14.458, 23.704, 34.03, 44.868, 55.734, 66.229, 76.043, 84.943, 92.773, 99.446, 104.929, 109.24, 112.435, 114.603, 115.849, 116.297,
  116.075, 115.312, 114.135, 112.66, 110.995, 109.234, 107.459, 105.736, 104.119, 102.645, 101.343, 100.229, 99.308, 98.58, 98.034, 97.659, 97.436,
  97.346, 97.369, 97.482, 97.666, 97.901, 98.169, 98.455, 98.744, 99.027, 99.293, 99.537, 99.753, 99.939, 100.094, 100.217, 100.31, 100.375, 100.414,
  100.432, 100.43, 100.414, 100.385, 100.348, 100.305, 100.258, 100.211, 100.165, 100.121, 100.081, 100.045, 100.014, 99.988, 99.967, 99.951, 99.94,
  99.933, 99.93, 99.93, 99.932, 99.936, 99.942, 99.949, 99.957, 99.965, 99.972, 99.979, 99.986, 99.992, 99.997, 100.001, 100.005, 100.008, 100.01,
  100.011, 100.011, 100.011, 100.011, 100.01, 100.01, 100.008, 100.007, 100.006, 100.005, 100.004, 100.002, 100.001, 100.001, 100, 99.999, 99.999,
  99.998, 99.998, 99.998, 99.998, 99.998, 99.998, 99.998, 99.999, 99.999, 99.999, 99.999, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
  100, 100
]

describe("LiveValue.scroll: Motion's four values from the Environment's ScrollSource (#234)", () => {
  it.effect("PS7: scrollX, scrollY and their progress follow the Probe's scroll as it's set", () =>
    Effect.gen(function* () {
      const probe = yield* TestProbe.pushable()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const v = yield* LiveValue.scroll()
        const read = () => [registry.get(v.scrollX), registry.get(v.scrollY), registry.get(v.scrollXProgress), registry.get(v.scrollYProgress)]
        expect(read(), "a page that doesn't scroll").toEqual([0, 0, 1, 1])
        const heard: Array<number> = []
        registry.subscribe(v.scrollYProgress, (p) => void heard.push(p))
        yield* probe.pushScroll({ x: { current: 10, length: 100, progress: 0.1 }, y: { current: 300, length: 600, progress: 0.5 } })
        expect(read()).toEqual([10, 300, 0.1, 0.5])
        expect(heard).toEqual([0.5])
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(probe.layer, AtomRegistry.layer)))
    }))
})

describe("LiveValue.scrollDerivationOf: how a value derives from a scroll, for a Timeline value (#240)", () => {
  /** Runs `body` with a pushable Probe's scroll, the harness's Clock, Frame loop and registry, and the InterpolatorRegistry. */
  const withScroll = <A>(
    body: Effect.Effect<A, never, Scope.Scope | AtomRegistry.AtomRegistry | InterpolatorRegistry.InterpolatorRegistry | ScrollSource.ScrollSource | FrameLoop.FrameLoop>,
  ) =>
    Effect.gen(function* () {
      const h = yield* harness()
      const probe = yield* TestProbe.pushable()
      return yield* body.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(probe.layer, h.layer, InterpolatorRegistry.layer)))
    })
  const container = { id: "box" }
  const target = { id: "card" }

  it.effect("TD1: each of scroll's four values describes what it reads, on which axis, from the scroll as given, with no transforms", () =>
    withScroll(Effect.gen(function* () {
      const options = { container, target, offset: ["start end", "end start"], axis: "y" as const }
      const v = yield* LiveValue.scroll(options)
      expect(LiveValue.scrollDerivationOf(v.scrollX)).toEqual(Option.some({ scroll: options, read: "current", axis: "x", transforms: [] }))
      expect(LiveValue.scrollDerivationOf(v.scrollY)).toEqual(Option.some({ scroll: options, read: "current", axis: "y", transforms: [] }))
      expect(LiveValue.scrollDerivationOf(v.scrollXProgress)).toEqual(Option.some({ scroll: options, read: "progress", axis: "x", transforms: [] }))
      expect(LiveValue.scrollDerivationOf(v.scrollYProgress)).toEqual(Option.some({ scroll: options, read: "progress", axis: "y", transforms: [] }))
      const page = yield* LiveValue.scroll()
      expect(LiveValue.scrollDerivationOf(page.scrollYProgress)).toEqual(Option.some({ scroll: {}, read: "progress", axis: "y", transforms: [] }))
    })))

  it.effect("TD2: a transform over one adds it as given (input, output, ease, clamp, a mixer's), and a transform over that adds a second", () =>
    withScroll(Effect.gen(function* () {
      const { scrollY, scrollYProgress } = yield* LiveValue.scroll({ container })
      const reveal = yield* LiveValue.transform(scrollYProgress, [0, 0.5, 1], [0, 1, 0])
      expect(LiveValue.scrollDerivationOf(reveal)).toEqual(Option.some({
        scroll: { container },
        read: "progress",
        axis: "y",
        transforms: [{ input: [0, 0.5, 1], output: [0, 1, 0], ease: Option.none(), clamp: true, mixed: false }],
      }))
      const header = yield* LiveValue.transform(scrollY, [0, 120], ["1", "0.9"], { ease: [Easing.easeOut], clamp: false })
      expect(Option.map(LiveValue.scrollDerivationOf(header), (d) => d.transforms)).toEqual(Option.some([
        { input: [0, 120], output: ["1", "0.9"], ease: Option.some([Easing.easeOut]), clamp: false, mixed: false },
      ]))
      const mixed = yield* LiveValue.transform(scrollYProgress, [0, 1], [{ n: 0 }, { n: 1 }], { mixer: (a, b) => (t) => ({ n: a.n + (b.n - a.n) * t }) })
      expect(Option.map(LiveValue.scrollDerivationOf(mixed), (d) => d.transforms[0]?.mixed)).toEqual(Option.some(true))
      const chained = yield* LiveValue.transform(reveal, [0, 1], [0.5, 1])
      expect(Option.map(LiveValue.scrollDerivationOf(chained), (d) => d.transforms.length)).toEqual(Option.some(2))
    })))

  it.effect("TD3: a value not derived from a scroll by ranges describes none: a plain Atom, a transform of one, a spring or a velocity of a scroll value", () =>
    withScroll(Effect.gen(function* () {
      const plain = Atom.make(0)
      expect(LiveValue.scrollDerivationOf(plain)).toEqual(Option.none())
      expect(LiveValue.scrollDerivationOf(yield* LiveValue.transform(plain, [0, 1], [0, 1]))).toEqual(Option.none())
      const { scrollYProgress } = yield* LiveValue.scroll({ container })
      const sprung = yield* LiveValue.spring(scrollYProgress)
      expect(LiveValue.scrollDerivationOf(sprung)).toEqual(Option.none())
      expect(LiveValue.scrollDerivationOf(yield* LiveValue.velocity(scrollYProgress))).toEqual(Option.none())
    })))
})

describe("LiveValue.velocity: a value's velocity per frame while it moves (#234)", () => {
  it.effect("VE1: 0 to begin with, and nothing runs until the source moves", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(5)
        const out = yield* LiveValue.velocity(source)
        expect(yield* frames(h.clock, registry, out, 3)).toEqual([0, 0, 0])
        expect(h.live()).toBe(0)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("VE2: each tick reads the change since the tick before over its dt; the first still tick reads 0 and ends the run", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const out = yield* LiveValue.velocity(source)
        const values: Array<number> = []
        for (const v of [1, 3, 6]) {
          registry.set(source, v)
          values.push(...(yield* frames(h.clock, registry, out, 1)))
        }
        expect(h.live(), "running while it moves").toBe(1)
        values.push(...(yield* frames(h.clock, registry, out, 2)))
        expect(values.map((v) => Math.round(v))).toEqual([60, 120, 180, 0, 0])
        expect(h.live(), "ended at the first still tick").toBe(0)
        registry.set(source, 7)
        expect(Math.round((yield* frames(h.clock, registry, out, 1))[0]!), "a new run from where it rested").toBe(60)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("VE3: velocity of a velocity is acceleration", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const v = yield* LiveValue.velocity(source)
        const a = yield* LiveValue.velocity(v)
        const accelerations: Array<number> = []
        for (const x of [1, 3, 6]) {
          registry.set(source, x)
          accelerations.push(...(yield* frames(h.clock, registry, a, 1)))
        }
        // Velocity 60, 120, 180 a second: acceleration 3600 a second squared, from the second tick on.
        expect(accelerations.slice(1).map((x) => Math.round(x))).toEqual([3600, 3600])
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("VE4: closing its Scope ends the run and the subscription", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const source = Atom.make(0)
        const scope = yield* Scope.make()
        const out = yield* LiveValue.velocity(source).pipe(Scope.provide(scope))
        registry.subscribe(out, () => {})
        registry.set(source, 1)
        yield* frames(h.clock, registry, out, 1)
        yield* Scope.close(scope, Exit.void)
        expect(h.live()).toBe(0)
        registry.set(source, 2)
        yield* frames(h.clock, registry, out, 2)
        expect(h.live()).toBe(0)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))
})

describe("LiveValue.time: milliseconds of wall time (#234)", () => {
  it.effect("TI1: adds each tick's dt in ms, unclamped: a 2 s stall counts in full", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const out = yield* LiveValue.time()
        expect(registry.get(out)).toBe(0)
        const first = yield* frames(h.clock, registry, out, 3)
        expect(first.map((ms) => Math.round(ms * 1000) / 1000)).toEqual([16.667, 33.333, 50])
        yield* h.clock.advance(2)
        expect(Math.round(registry.get(out))).toBe(2050)
        expect(h.live(), "one run, never settling").toBe(1)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("TI2: closing its Scope ends the run", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const scope = yield* Scope.make()
        const out = yield* LiveValue.time().pipe(Scope.provide(scope))
        registry.subscribe(out, () => {})
        yield* frames(h.clock, registry, out, 2)
        yield* Scope.close(scope, Exit.void)
        expect(h.live()).toBe(0)
        const at = registry.get(out)
        yield* frames(h.clock, registry, out, 2)
        expect(registry.get(out)).toBe(at)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))
})

describe("LiveValue.eachFrame: each frame's time and delta to a callback (#443)", () => {
  /** What `eachFrame`'s callback was told, rounded to a thousandth of a ms. */
  const told = () => {
    const calls: Array<readonly [number, number]> = []
    const round = (ms: number): number => Math.round(ms * 1000) / 1000
    return { calls, callback: (time: number, delta: number) => void calls.push([round(time), round(delta)]) }
  }

  it.effect("AF1: time 0 at its first frame, then the total of each tick's dt, unclamped; delta the tick's dt", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const { calls, callback } = told()
        yield* LiveValue.eachFrame(callback)
        expect(calls, "nothing until the first frame").toEqual([])
        yield* h.clock.advance(F)
        yield* h.clock.advance(F)
        yield* h.clock.advance(0.025)
        expect(calls).toEqual([
          [0, 16.667],
          [16.667, 16.667],
          [41.667, 25],
        ])
        expect(h.live(), "one run, never settling").toBe(1)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("AF2: delta held to 1–40 ms: a 2 s stall's is 40, a 0.5 ms frame's 1; time counts both in full", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const { calls, callback } = told()
        yield* LiveValue.eachFrame(callback)
        yield* h.clock.advance(F)
        yield* h.clock.advance(2)
        yield* h.clock.advance(0.0005)
        expect(calls).toEqual([
          [0, 16.667],
          [2000, 40],
          [2000.5, 1],
        ])
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))

  it.effect("AF3: closing its Scope ends the run: no frame after", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* Effect.gen(function* () {
        const { calls, callback } = told()
        const scope = yield* Scope.make()
        yield* LiveValue.eachFrame(callback).pipe(Scope.provide(scope))
        yield* h.clock.advance(F)
        yield* h.clock.advance(F)
        yield* Scope.close(scope, Exit.void)
        expect(h.live()).toBe(0)
        yield* h.clock.advance(F)
        expect(calls.length).toBe(2)
      }).pipe(Effect.scoped, Effect.provide(h.layer))
    }))
})
