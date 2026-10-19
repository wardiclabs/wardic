/**
 * The `LiveValue` module (#130, ADR-0043): helpers that derive one **Live value** from another. A
 * Live value is a value the user moves themselves, given in an element's `style`: the key's
 * `style` link, which the element follows while no entry of the Override stack sets the key
 * (CONTEXT.md). Its shared form is an `effect/reactivity` `Atom`, as core's other live data is
 * (`Probe.viewport`); each binding also takes its framework's own reactive value.
 *
 * - `transform`: a value mapped from another through ranges (Motion's `useTransform`), each pair
 *   of outputs blended through the `InterpolatorRegistry`, so colours and unit strings map as
 *   `animate` blends them. `interpolate` is its mapping as a plain function (Motion's
 *   `interpolate`), for a binding that maps its own reactive value.
 * - `spring`: a value that follows another with a spring (Motion's `useSpring`), stepped on the
 *   Frame loop while it moves and idle once it rests.
 * - `scroll`: a container's scroll and progress (Motion's `useScroll`), from the Environment's
 *   `Probe.scroll` (#234).
 * - `velocity`: another value's velocity, per frame while it moves (Motion's `useVelocity`).
 * - `time`: milliseconds since it started, wall time (Motion's `useTime`).
 *
 * Tier 2 (ADR-0008): Effect-typed, for bindings, which wrap them (Solid's `createTransform`,
 * `createSpring`).
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import { identity } from "effect/Function"
import * as Option from "effect/Option"
import { Atom, AtomRegistry } from "effect/reactivity"
import type * as Scope from "effect/Scope"
import * as FrameLoop from "./FrameLoop.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import type * as Frame from "./Frame.ts"
import * as Machine from "./Machine.ts"
import * as Probe from "./Probe.ts"
import * as Supersede from "./Supersede.ts"

/** `transform`'s options. */
export interface TransformOptions {
  /** Hold the first and last output outside the input's range. Default `true`, as Motion's is. */
  readonly clamp?: boolean
}

/** One stretch of a `transform`'s range: its input span and its outputs' blend. */
interface Stretch<O> {
  readonly from: number
  readonly span: number
  readonly blend: (t: number) => O
}

/**
 * The mapping `transform` applies, as a plain function: an input at `input[i]` gives `output[i]`,
 * and one between two stops blends their outputs by its progress between them (each pair through
 * the `InterpolatorRegistry`, resolved once, here). `input` ascends, and is as long as `output`,
 * with two stops or more; anything else is a defect. Outside the range the ends hold, unless
 * `clamp: false`, which carries the first or last stretch on.
 */
export const interpolate = <O extends number | string>(
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options: TransformOptions = {},
): Effect.Effect<(v: number) => O, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.gen(function* () {
    if (input.length < 2 || input.length !== output.length) {
      return yield* Effect.die(new Error(`LiveValue: input and output need the same length, two or more (got ${input.length} and ${output.length})`))
    }
    const registry = yield* InterpolatorRegistry.InterpolatorRegistry
    const pairs = Arr.zip(Arr.zip(input, Arr.drop(input, 1)), Arr.zip(output, Arr.drop(output, 1)))
    const resolved = yield* Effect.forEach(pairs, ([[from, to], [a, b]]) =>
      Effect.map(registry.resolve(a, b), (blend): Stretch<O> => ({ from, span: to - from, blend: blend as (t: number) => O })))
    // Two stops or more, checked above: one stretch or more.
    const stretches = resolved as unknown as Arr.NonEmptyReadonlyArray<Stretch<O>>
    const clamp = options.clamp !== false
    return (v: number): O => stretchAt(stretches, clamp, v)
  })

/**
 * `source` mapped through ranges, as `interpolate` maps a number: an Atom that follows `source`,
 * mapped afresh on each change.
 */
export const transform = <O extends number | string>(
  source: Atom.Atom<number>,
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options: TransformOptions = {},
): Effect.Effect<Atom.Atom<O>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.map(interpolate(input, output, options), (map) => Atom.make((get) => map(get(source))))

/** The output at `v`: its stretch's blend at its progress through it. Read on each change of the source. */
const stretchAt = <O>(stretches: Arr.NonEmptyReadonlyArray<Stretch<O>>, clamp: boolean, v: number): O => {
  // The last stretch starting at or below `v`; below the first, the first.
  const stretch = Option.match(Arr.findLast(stretches, (s) => v >= s.from), { onNone: () => Arr.headNonEmpty(stretches), onSome: identity })
  const t = (v - stretch.from) / stretch.span
  return stretch.blend(Bool.match(clamp, { onTrue: () => Math.min(Math.max(t, 0), 1), onFalse: () => t }))
}

/**
 * A value that follows `source` with a spring (`options`, as `Machine.spring`'s): it starts where
 * the source is, and from each change on, a `Machine.chase` toward the source runs on the Frame
 * loop, reading the source afresh on every step, until it comes to rest there. Then the run
 * ends, and nothing runs until the source moves again. The run and the subscription end with
 * the Scope; the Atom is held in the registry until then, and after it only while subscribed.
 */
export const spring = (
  source: Atom.Atom<number>,
  options: Machine.SpringOptions = {},
): Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    // Mounted for the Scope, not kept alive: a kept-alive Atom's node never leaves the registry.
    const out = Atom.make(registry.get(source))
    const unmount = registry.mount(out)
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    let token = Supersede.make()
    let velocity = 0
    // Whether a run follows the source now: a change while it does costs a check, nothing built.
    let running = false
    /** Follow the source from where `out` is, until it rests. */
    const follow = (): void => {
      if (running) return
      running = true
      token = Supersede.make()
      const ending = token
      const chase = Machine.chase(() => registry.get(source), { ...options, from: registry.get(out), velocity })
      run(
        chase.pipe(
          Machine.run(
            (frame) => {
              registry.set(out, frame.value)
              velocity = frame.velocity
              // At rest on the source: end the run; the next change starts another.
              if (frame.done) {
                velocity = 0
                running = false
                Supersede.end(ending)
              }
              return undefined
            },
            { supersede: ending },
          ),
        ),
        { onlyIfMissing: true },
      )
    }
    const unsubscribe = registry.subscribe(source, follow)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe()
        Supersede.end(token)
        unmount()
      }))
    return out
  })

/** What `scroll` gives: Motion's four values, each an Atom. */
export interface ScrollValues {
  /** How far the container is scrolled across, in the Environment's units. */
  readonly scrollX: Atom.Atom<number>
  /** How far the container is scrolled down. */
  readonly scrollY: Atom.Atom<number>
  /** Progress across, 0 to 1 (through the offsets, with `target` or `offset` on `axis: "x"`). */
  readonly scrollXProgress: Atom.Atom<number>
  /** Progress down, 0 to 1 (through the offsets, with `target` or `offset` on `axis: "y"`, the default). */
  readonly scrollYProgress: Atom.Atom<number>
}

/**
 * A container's scroll as Motion's four values (`useScroll`): how far it's scrolled on each axis,
 * and the progress through its range, or, with a `target` or an `offset`, through the offsets the
 * target passes on `axis` (#234, ADR-0043 *Amendment (#233, #234)*). Each is derived from the
 * Environment's `Probe.scroll`, which the Environment sets within the scroll's events, so a value
 * derived from one is written in the frame that shows the scroll. The container's listeners are
 * held while the Scope is.
 */
export const scroll = (options: Probe.ScrollOptions = {}): Effect.Effect<ScrollValues, never, Probe.Probe | Scope.Scope> =>
  Effect.gen(function* () {
    const probe = yield* Probe.Probe
    const info = yield* probe.scroll(options)
    return {
      scrollX: Atom.make((get) => get(info).x.current),
      scrollY: Atom.make((get) => get(info).y.current),
      scrollXProgress: Atom.make((get) => get(info).x.progress),
      scrollYProgress: Atom.make((get) => get(info).y.progress),
    }
  })

/** A machine of one number a tick, from a run's step. */
const numberMachine = (name: string, settles: boolean, start: () => (dt: number) => Frame.Frame<number>): Machine.Machine<Frame.Frame<number>> =>
  Machine.make({ settles, span: { name, attributes: {} }, start })

/**
 * `source`'s velocity, in its units a second (Motion's `useVelocity`): 0 to begin with, and from
 * each change on, a run on the Frame loop that reads the source each tick and sets the velocity to
 * its change since the end of the tick before over the tick's `dt` (clamped at `Machine.MAX_DT`, as
 * every run is). The first tick that finds no change sets 0 and ends the run, so nothing runs while
 * the source rests. "Since the end of the tick before", read by an `afterTick` hook, not the run's
 * own last read: a run started inside a tick takes its first step at the next one, and would
 * otherwise count two frames' change over one `dt`. Velocity is a value too: `velocity(velocity(x))`
 * is acceleration. The run, the hook and the subscription end with the Scope.
 */
export const velocity = (source: Atom.Atom<number>): Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    // Mounted for the Scope, not kept alive: a kept-alive Atom's node never leaves the registry.
    const out = Atom.make(0)
    const unmount = registry.mount(out)
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    // The source at the end of the tick before: where each tick's change is read from.
    let previous = registry.get(source)
    const loop = yield* FrameLoop.FrameLoop
    yield* loop.afterTick(() => {
      previous = registry.get(source)
      return undefined
    })
    // One token for its lifetime, and one run program, started afresh on the change after a rest:
    // a change while a run goes costs a check, nothing built.
    const token = Supersede.make()
    let running = false
    const program = numberMachine("wardic.velocity", true, () => (dt) => {
      const step = Math.min(dt, Machine.MAX_DT)
      // A tick in no time (never from the Clock) reads as still.
      if (step === 0) return { value: 0, done: true }
      const v = (registry.get(source) - previous) / step
      return { value: v, done: v === 0 }
    }).pipe(
      Machine.run((frame) => {
        registry.set(out, frame.value)
        if (frame.done) running = false
        return undefined
      }, { supersede: token }),
    )
    const follow = (): void => {
      if (running) return
      running = true
      run(program, { onlyIfMissing: true })
    }
    const unsubscribe = registry.subscribe(source, follow)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe()
        Supersede.end(token)
        unmount()
      }))
    return out
  })

/**
 * Milliseconds since it started (Motion's `useTime`): a run on the Frame loop that never settles,
 * adding each tick's `dt` as the Clock gives it, unclamped, so it keeps wall time (a hidden tab's
 * minutes count in full, as Motion's do). It keeps the Clock ticking every frame for as long as it
 * runs; the run ends with the Scope.
 */
export const time = (): Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const out = Atom.make(0)
    const unmount = registry.mount(out)
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    const token = Supersede.make()
    const elapsed = numberMachine("wardic.time", false, () => {
      let ms = 0
      return (dt) => {
        ms += dt * 1000
        return { value: ms, done: false }
      }
    })
    run(
      elapsed.pipe(
        Machine.run((frame) => {
          registry.set(out, frame.value)
          return undefined
        }, { supersede: token }),
      ),
    )
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Supersede.end(token)
        unmount()
      }))
    return out
  })

