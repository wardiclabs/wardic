// Live values (#130, ADR-0043): core's helpers that derive one from another, over `effect/reactivity`
// Atoms. `transform` maps ranges through the InterpolatorRegistry; `spring` follows its source on the
// Frame loop, with a run only while it moves.
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
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

  it.effect("TR5: input and output of different lengths, or fewer than two stops, is a defect", () =>
    Effect.gen(function* () {
      const source = Atom.make(0)
      const lengths = yield* Effect.exit(LiveValue.transform(source, [0, 1, 2], [0, 1]))
      const single = yield* Effect.exit(LiveValue.transform(source, [0], [1]))
      expect(Exit.isFailure(lengths) && Exit.hasDies(lengths)).toBe(true)
      expect(Exit.isFailure(single) && Exit.hasDies(single)).toBe(true)
    }).pipe(Effect.provide(layer)))
})

describe("LiveValue.spring: follows its source on the Frame loop, idle at rest (#130)", () => {
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
