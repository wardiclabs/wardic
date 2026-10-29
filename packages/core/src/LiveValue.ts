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
 * - `jump`: a value set at once, not as motion (Motion's `MotionValue.jump`, #257 item 7): a
 *   spring's output ends its run there, and a `velocity` of it reads no motion.
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
import { constFalse, constTrue, constUndefined, constVoid, dual, identity } from "effect/Function"
import * as Option from "effect/Option"
import { Atom, AtomRegistry } from "effect/reactivity"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import * as FrameLoop from "./FrameLoop.ts"
import * as Easing from "./Easing.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import type * as Frame from "./Frame.ts"
import * as Machine from "./Machine.ts"
import * as Probe from "./Probe.ts"
import * as Supersede from "./Supersede.ts"

/** `transform`'s options. */
export interface TransformOptions {
  /** Hold the first and last output outside the input's range. Default `true`, as Motion's is. */
  readonly clamp?: boolean
  /**
   * How each stretch of the input range eases (#360), as Motion's `useTransform`'s `ease`: one
   * Easing definition for every stretch, or an array with one per stretch, linear for any it's
   * short of. Default linear.
   */
  readonly ease?: Easing.Definition | ReadonlyArray<Easing.Definition>
}

/** Stretch `i`'s easing (#360): the one for every stretch, or its own from a list, linear past the list's end, as Motion's. */
const easeOfStretch = (ease: Easing.Definition | ReadonlyArray<Easing.Definition> | undefined, i: number): Easing.Easing =>
  UndefinedOr.match(ease, {
    onUndefined: () => Easing.linear,
    onDefined: (given) =>
      Bool.match(Bool.and(Array.isArray(given), Bool.not(Easing.isBezier(given))), {
        onTrue: () => UndefinedOr.match((given as ReadonlyArray<Easing.Definition>)[i], { onUndefined: () => Easing.linear, onDefined: Easing.resolve }),
        onFalse: () => Easing.resolve(given as Easing.Definition),
      }),
  })

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
    const resolved = yield* Effect.forEach(pairs, ([[from, to], [a, b]], i) =>
      Effect.map(registry.resolve(a, b), (blend): Stretch<O> => {
        // Each stretch's easing, resolved once, here: linear leaves its blend as it is.
        const ease = easeOfStretch(options.ease, i)
        const mix = blend as (t: number) => O
        return { from, span: to - from, blend: Bool.match(ease === Easing.linear, { onTrue: () => mix, onFalse: () => (t: number): O => mix(ease(t)) }) }
      }))
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

/** `spring`'s options: `Machine.spring`'s, and Motion's `skipInitialAnimation`. */
export interface SpringOptions extends Machine.SpringOptions {
  /**
   * The source's first change lands at once, as a `jump`, and only the changes after it spring
   * (Motion's `skipInitialAnimation`): for a source set once after it starts, as a scroll the
   * browser restores after the page mounts. Default `false`.
   */
  readonly skipInitialAnimation?: boolean
  /**
   * Every change of the source lands at once, as a `jump` (#468, Motion's transition
   * `skipAnimations`): a **Skipped animation**. Default `false`.
   */
  readonly skipAnimations?: boolean
}

/**
 * Who hears each Atom's jumps, per registry: a `spring` of its own output, ending its run, and a
 * `velocity` of its source, reading the jump as no motion. Weak both ways: a registry or an Atom
 * gone takes its listeners with it, and an Atom nothing listens to costs nothing.
 */
const jumps = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<Atom.Atom<number>, Set<(value: number) => void>>>()

/** Hear `atom`'s jumps in `registry`, until the stop it gives back. */
const onJump = (registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<number>, hear: (value: number) => void): (() => void) => {
  const byAtom = UndefinedOr.match(jumps.get(registry), {
    onDefined: identity,
    onUndefined: () => {
      const made = new WeakMap<Atom.Atom<number>, Set<(value: number) => void>>()
      jumps.set(registry, made)
      return made
    },
  })
  const listeners = UndefinedOr.match(byAtom.get(atom), {
    onDefined: identity,
    onUndefined: () => {
      const made = new Set<(value: number) => void>()
      byAtom.set(atom, made)
      return made
    },
  })
  listeners.add(hear)
  return () => {
    listeners.delete(hear)
  }
}

/** `atom` set to `value` in `registry` as a jump: its listeners told first, then the Atom set. */
const jumpIn = (registry: AtomRegistry.AtomRegistry, atom: Atom.Writable<number>, value: number): void => {
  const listeners = UndefinedOr.match(jumps.get(registry), { onDefined: (byAtom) => byAtom.get(atom), onUndefined: constUndefined })
  UndefinedOr.match(listeners, { onDefined: (all) => Arr.forEach(Arr.fromIterable(all), (hear) => hear(value)), onUndefined: constVoid })
  registry.set(atom, value)
}

/**
 * Jump `atom` to `value` (Motion's `MotionValue.jump`, #257 item 7): set at once, not as motion.
 * A `spring` whose output it is ends its run there with no velocity, and rests there until its
 * source next changes, then springs from there; a `velocity` of it reads the jump as no motion, 0
 * in that frame. `atom` is writable, a `spring`'s output or one of the user's; any other is a
 * defect.
 */
export const jump: {
  (value: number): (atom: Atom.Atom<number>) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>
  (atom: Atom.Atom<number>, value: number): Effect.Effect<void, never, AtomRegistry.AtomRegistry>
} = dual(2, (atom: Atom.Atom<number>, value: number): Effect.Effect<void, never, AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    if (Bool.not(Atom.isWritable(atom))) {
      return yield* Effect.die(new Error("LiveValue.jump: the Atom isn't writable (a spring's output, or one of your own)"))
    }
    const registry = yield* AtomRegistry.AtomRegistry
    jumpIn(registry, atom as Atom.Writable<number>, value)
  }))

/**
 * A value that follows `source` with a spring (`options`, as `Machine.spring`'s): it starts where
 * the source is, and from each change on, a `Machine.chase` toward the source runs on the Frame
 * loop, reading the source afresh on every step, until it comes to rest there. Then the run
 * ends, and nothing runs until the source moves again. With `skipInitialAnimation`, the source's
 * first change is a `jump`; with `skipAnimations`, or while `skipped()` says so (#468, read at each
 * change: a binding's subtree setting), every change is. A `jump` of its output ends the run there,
 * with no velocity. The run and the subscription end with the Scope; the Atom is held in the
 * registry until then, and after it only while subscribed.
 */
export const spring = (
  source: Atom.Atom<number>,
  options: SpringOptions = {},
  skipped: () => boolean = constFalse,
): Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const { skipInitialAnimation, skipAnimations, ...springOptions } = options
    const skips = Bool.match(skipAnimations === true, { onTrue: () => constTrue, onFalse: () => skipped })
    // Mounted for the Scope, not kept alive: a kept-alive Atom's node never leaves the registry.
    const out = Atom.make(registry.get(source))
    const unmount = registry.mount(out)
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    let token = Supersede.make()
    let velocity = 0
    // Whether a run follows the source now: a change while it does costs a check, nothing built.
    let running = false
    // Whether the source's next change is a jump: its first, with `skipInitialAnimation`.
    let skipping = skipInitialAnimation === true
    /** Follow the source from where `out` is, until it rests. */
    const follow = (): void => {
      if (Bool.or(skipping, skips())) {
        skipping = false
        jumpIn(registry, out, registry.get(source))
        return
      }
      if (running) return
      running = true
      token = Supersede.make()
      const ending = token
      const chase = Machine.chase(() => registry.get(source), { ...springOptions, from: registry.get(out), velocity })
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
    // A jump of `out`: the run ends where it's set, with no velocity, and the next change follows from there.
    const unhear = onJump(registry, out, () => {
      running = false
      velocity = 0
      Supersede.end(token)
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe()
        unhear()
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
    // A jump of the source isn't motion: the change is read from where it jumped to.
    const unhear = onJump(registry, source, (value) => {
      previous = value
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
        unhear()
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

