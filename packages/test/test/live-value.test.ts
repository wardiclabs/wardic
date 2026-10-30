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
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as Machine from "@wardic/core/Machine"
import { TestClock, TestProbe } from "@wardic/test"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
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
        // Machine.chase toward a target that moves at the same frame.
        let target = 100
        const step = Machine.chase(() => target).start()
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

describe("LiveValue.scroll: Motion's four values from the Environment's Probe.scroll (#234)", () => {
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
