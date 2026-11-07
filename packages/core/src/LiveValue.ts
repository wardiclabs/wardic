/**
 * Live values: values derived from other values as they change, each an `effect/reactivity` Atom an
 * element's `style` can follow. `transform` maps one through ranges, `follow` and `spring` follow one on
 * a transition, `velocity` tracks how fast one moves, `scroll` gives a container's scroll, `time` the
 * time since it started, and `eachFrame` calls you every frame. A binding wraps them in its own
 * reactive values, as Solid's `createSpring` and `createTransform` do.
 *
 * @example
 * import * as LiveValue from "@wardic/core/LiveValue"
 *
 * const pointerX = Atom.make(0)
 * const x = yield* LiveValue.spring(pointerX, { stiffness: 300, damping: 30 })
 * const opacity = yield* LiveValue.transform(x, [0, 200], [1, 0])
 */
// #130, ADR-0043: a Live value is one the user moves themselves, given in an element's `style`: the
// key's `style` link, which the element follows while no entry of the Override stack sets it
// (CONTEXT.md). Its shared form is an Atom, as core's other live data is (`Probe.viewport`). Motion's
// `useTransform` (with a `mixer`, #440), `interpolate`, `followValue` (#441), `useSpring`,
// `MotionValue.jump` (#257 item 7), `useScroll` (#234), `useVelocity`, `useTime`, `useAnimationFrame`
// (#443). Tier 2 (ADR-0008): Effect-typed, for bindings, which wrap them.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import * as Match from "effect/Match"
import { constant, constFalse, constTrue, constUndefined, constVoid, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Rec from "effect/Record"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import * as FrameLoop from "./FrameLoop.ts"
import * as Easing from "./Easing.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import type * as Frame from "./Frame.ts"
import * as Machine from "./Machine.ts"
import * as ScrollSource from "./ScrollSource.ts"
import * as Supersede from "./Supersede.ts"
import { dual } from "./internal/dual.ts"

/** A blend between two outputs, as Motion's `MixerFactory`: made once per stretch, then read at each progress through it, 0 to 1. */
// #440.
export type Mixer<O> = (from: O, to: O) => (t: number) => O

/** `transform`'s options. */
export interface TransformOptions<O = number | string> {
  /** Hold the first and last output outside the input's range. Default `true`, as Motion's is. */
  readonly clamp?: boolean
  /**
   * How each stretch of the input range eases, as Motion's `useTransform`'s `ease`: one easing for every
   * stretch, or a list, one each, linear for any it's short of. Default linear. A descending range's
   * stretches take it reversed, as Motion's.
   */
  // #360, #440.
  readonly ease?: Easing.Definition | ReadonlyArray<Easing.Definition>
  /**
   * How two outputs blend, as Motion's `mixer`: made once per stretch from its two outputs, read through
   * the stretch's `ease`. Given, it takes the place of the `InterpolatorRegistry`'s blends, so the
   * outputs can be any type it blends. Default: the registry's, of numbers and strings.
   */
  // #440.
  readonly mixer?: Mixer<O>
}

/** `transform`'s options with a `mixer`: its outputs any type the mixer blends. */
// #440.
export interface MixedTransformOptions<O> extends TransformOptions<O> {
  readonly mixer: Mixer<O>
}

/** Stretch `i`'s easing (#360): the one for every stretch, or its own from a list, linear past the list's end, as Motion's. */
const easeOfStretch = (ease: Easing.Definition | ReadonlyArray<Easing.Definition> | undefined, i: number): Easing.Easing =>
  UndefinedOr.match(ease, {
    onUndefined: () => Easing.linear,
    onDefined: (given) =>
      Bool.match(Bool.and(Arr.isArray(given), Bool.not(Easing.isBezier(given))), {
        onTrue: () => UndefinedOr.match((given as ReadonlyArray<Easing.Definition>)[i], { onUndefined: () => Easing.linear, onDefined: Easing.resolve }),
        onFalse: () => Easing.resolve(given as Easing.Definition),
      }),
  })

/** One stretch of a `transform`'s range: its input's ends and its outputs' blend. */
interface Stretch<O> {
  readonly from: number
  readonly to: number
  readonly blend: (t: number) => O
}

/** A mapping's outputs blended: by the app's `mixer` (#440), or through the `InterpolatorRegistry`. */
const blendsOf = <O>(mixer: Mixer<O> | undefined, registry: Context.Service.Shape<typeof InterpolatorRegistry.InterpolatorRegistry>): ((a: O, b: O) => Effect.Effect<(t: number) => O>) =>
  UndefinedOr.match(mixer, {
    onUndefined: () => (a: O, b: O) => registry.resolve(a, b) as Effect.Effect<(t: number) => O>,
    onDefined: (mix) => (a: O, b: O) => Effect.sync(() => mix(a, b)),
  })

/**
 * `interpolate`'s two forms: outputs of numbers or strings, which the `InterpolatorRegistry` blends, or
 * of any type, with a `mixer` to blend them.
 */
interface Interpolate {
  <O extends number | string>(input: ReadonlyArray<number>, output: ReadonlyArray<O>, options?: TransformOptions<O>): Effect.Effect<(v: number) => O, never, InterpolatorRegistry.InterpolatorRegistry>
  <O>(input: ReadonlyArray<number>, output: ReadonlyArray<O>, options: MixedTransformOptions<O>): Effect.Effect<(v: number) => O, never, InterpolatorRegistry.InterpolatorRegistry>
}

/**
 * The mapping `transform` applies, as a plain function, Motion's `interpolate`: an input at `input[i]`
 * gives `output[i]`, and one between two stops blends their outputs by its progress between them,
 * through the `InterpolatorRegistry` or the `mixer` given, resolved once. `input` and `output` are as
 * long, one stop or more. As Motion's:
 * - **one stop**, or two with one output, gives that output;
 * - **a descending range** is mapped reversed, both lists, its `ease` list too;
 * - **a stretch of no length** gives its second output at or past it, and, the first one, its first
 *   output before it;
 * - outside the range the ends hold, unless `clamp: false`, which carries the first or last stretch on.
 *
 * @example
 * const width = yield* LiveValue.interpolate([0, 1, 2], ["0px", "80px", "120px"])
 * width(1.5) // "100px"
 * width(3) // "120px": the end holds
 */
// #440. Anything else is a defect.
export const interpolate: Interpolate = <O>(input: ReadonlyArray<number>, output: ReadonlyArray<O>, options?: TransformOptions<O>) =>
  interpolateWith(input, output, options)

/** {@link interpolate}, for outputs of any type: a `mixer` blends them, else the registry does. */
const interpolateWith: <O>(
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options?: TransformOptions<O>,
) => Effect.Effect<(v: number) => O, never, InterpolatorRegistry.InterpolatorRegistry> = Effect.fnUntraced(
  function* <O>(input: ReadonlyArray<number>, output: ReadonlyArray<O>, options: TransformOptions<O> = {}) {
    if (Bool.or(input.length === 0, input.length !== output.length)) {
      return yield* Effect.die(new Error(`LiveValue: input and output need the same length, one or more (got ${input.length} and ${output.length})`))
    }
    if (input.length === 1) return constant(output[0] as O)
    if (Bool.and(input.length === 2, output[0] === output[1])) return constant(output[1] as O)
    const descending = (input[0] as number) > (input[input.length - 1] as number)
    const ins = Bool.match(descending, { onTrue: () => Arr.reverse(input), onFalse: () => Arr.fromIterable(input) })
    const outs = Bool.match(descending, { onTrue: () => Arr.reverse(output), onFalse: () => Arr.fromIterable(output) })
    const blends = blendsOf(options.mixer, yield* InterpolatorRegistry.InterpolatorRegistry)
    const pairs = Arr.zip(Arr.zip(ins, Arr.drop(ins, 1)), Arr.zip(outs, Arr.drop(outs, 1)))
    const resolved = yield* Effect.forEach(pairs, ([[from, to], [a, b]], i) =>
      Effect.map(blends(a, b), (mix): Stretch<O> => {
        // Each stretch's easing, resolved once, here: linear leaves its blend as it is.
        const ease = easeOfStretch(options.ease, i)
        return { from, to, blend: Bool.match(ease === Easing.linear, { onTrue: () => mix, onFalse: () => (t: number): O => mix(ease(t)) }) }
      }))
    // Two stops or more, checked above: one stretch or more.
    const stretches = resolved as unknown as Arr.NonEmptyReadonlyArray<Stretch<O>>
    const first = Arr.headNonEmpty(stretches).from
    const last = Arr.lastNonEmpty(stretches).to
    // Below a first stretch of no length: its first output (Motion's `isZeroDeltaRange`).
    const before = Bool.match(first === Arr.headNonEmpty(stretches).to, { onTrue: () => first, onFalse: () => Number.NEGATIVE_INFINITY })
    const at = (v: number): O => {
      if (v < before) return outs[0] as O
      const stretch = stretchAt(stretches, v)
      return stretch.blend(progressOf(stretch, v))
    }
    return Bool.match(options.clamp !== false, { onTrue: () => (v: number): O => at(Math.min(Math.max(v, first), last)), onFalse: () => at })
  })

/**
 * `source` mapped through ranges, as `interpolate` maps a number: an Atom that follows `source`, mapped
 * afresh at each change.
 *
 * @example
 * const scale = yield* LiveValue.transform(scrollY, [0, 300], [1, 0.8])
 */
export const transform: {
  <O extends number | string>(source: Atom.Atom<number>, input: ReadonlyArray<number>, output: ReadonlyArray<O>, options?: TransformOptions<O>): Effect.Effect<Atom.Atom<O>, never, InterpolatorRegistry.InterpolatorRegistry>
  <O>(source: Atom.Atom<number>, input: ReadonlyArray<number>, output: ReadonlyArray<O>, options: MixedTransformOptions<O>): Effect.Effect<Atom.Atom<O>, never, InterpolatorRegistry.InterpolatorRegistry>
} = <O>(source: Atom.Atom<number>, input: ReadonlyArray<number>, output: ReadonlyArray<O>, options: TransformOptions<O> = {}) =>
  Effect.map(interpolateWith(input, output, options), (map) => Atom.make((get) => map(get(source))))

/** `v`'s stretch, as Motion's: the first that ends above it, else the last. Read on each change of the source. */
const stretchAt = <O>(stretches: Arr.NonEmptyReadonlyArray<Stretch<O>>, v: number): Stretch<O> =>
  Option.match(Arr.findFirst(stretches, (s) => v < s.to), { onNone: () => Arr.lastNonEmpty(stretches), onSome: identity })

/** `v`'s progress through `stretch`, as Motion's `progress`: 1 through a stretch of no length. */
const progressOf = <O>(stretch: Stretch<O>, v: number): number => {
  const span = stretch.to - stretch.from
  if (span === 0) return 1
  return (v - stretch.from) / span
}

/** What a **Follow value** lands at once, as a `jump`, rather than animating to. */
export interface FollowSkips {
  /**
   * The source's first change lands at once, as a `jump`, and only the changes after it animate
   * (Motion's `skipInitialAnimation`): for a source set once after it starts, as a scroll position
   * restored after the app mounts. Default `false`.
   */
  readonly skipInitialAnimation?: boolean
  /**
   * Every change of the source lands at once, as a `jump` (Motion's transition `skipAnimations`): a
   * **Skipped animation**. Default `false`.
   */
  // #468.
  readonly skipAnimations?: boolean
}

/** `spring`'s options: `Machine.spring`'s, and the skips. */
export interface SpringOptions extends Machine.SpringOptions, FollowSkips {}

/**
 * A follow's transition, in seconds, as Motion's `useFollowValue`'s: a spring (one with no `type` is), a
 * tween, or an inertia. What it leaves out is Motion's follower's: a spring's physics 100 / 10 / 1
 * unless it's set by time, at rest within 0.001 and below 0.01 a second (an inertia's too), and a
 * tween's 0.3 s `easeInOut`. Its `delay` holds the value where it is at each change of the source, then
 * it goes on toward the latest: a debounce, as Motion's.
 */
// #441.
export type FollowTransition =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from">)
  | ({ readonly type: "tween" } & Machine.TweenOptions)
  | ({
    readonly type: "inertia"
    /** The velocity each glide starts from, per second: the value's own when left out. */
    readonly velocity?: number
    /** Seconds it holds where it is at each change before it glides. */
    readonly delay?: number
  } & Machine.InertiaOptions)

/** `follow`'s options: its transition, and the skips. */
export type FollowOptions = FollowTransition & FollowSkips

/**
 * Who hears each Atom's jumps, per registry: a `spring` of its own output, ending its run, and a
 * `velocity` of its source, reading the jump as no motion. Weak both ways: a registry or an Atom
 * gone takes its listeners with it, and an Atom nothing listens to costs nothing.
 */
// Module state (#460, Q7): each registry's jump listeners, held weakly by the registry: one an Environment.
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

declare const FollowedBrand: unique symbol

/**
 * A Live value that follows another on a transition: what `follow` and `spring` make. Read as any Atom
 * of a number; beside a writable Atom of yours, the one Atom `jump` takes.
 */
// #618 (F2): `jump` took any Atom and died unless it was writable. A spring's output is writable
// underneath, but typed as one an app can set with `registry.set` it would skip `jump`'s listeners.
export interface Followed extends Atom.Atom<number> {
  readonly [FollowedBrand]: true
}

/**
 * Sets `atom` to `value` at once, not as motion, as Motion's `MotionValue.jump`: a `spring` whose output
 * it is ends its run there with no velocity, and rests there until its source next changes, then springs
 * from there; a `velocity` of it reads the jump as no motion. `atom` is a `spring`'s output, or a
 * writable Atom of yours.
 *
 * @example
 * yield* LiveValue.jump(x, 0) // back to the start, without a spring
 */
// #257 item 7. Its type takes no other Atom (#618); one cast past it is a defect.
export const jump: {
  (value: number): (atom: Followed | Atom.Writable<number>) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>
  (atom: Followed | Atom.Writable<number>, value: number): Effect.Effect<void, never, AtomRegistry.AtomRegistry>
} = dual(
  2,
  Effect.fnUntraced(function* (atom: Followed | Atom.Writable<number>, value: number): Effect.fn.Return<void, never, AtomRegistry.AtomRegistry> {
    if (Bool.not(Atom.isWritable(atom))) {
      return yield* Effect.die(new Error("LiveValue.jump: the Atom isn't writable (a spring's output, or one of your own)"))
    }
    const registry = yield* AtomRegistry.AtomRegistry
    jumpIn(registry, atom as Atom.Writable<number>, value)
  }),
)

/** Motion's spring, for the physics a follow's spring leaves out (`motion-dom`'s `springDefaults`). */
const MOTION_PHYSICS = { stiffness: 100, damping: 10, mass: 1 } as const

/** Motion's follower's rest thresholds, for those a spring or an inertia leaves out (`follow()`'s). */
const FOLLOW_REST = { restDelta: 0.001, restSpeed: 0.01 } as const

/** Motion's follower's tween, for what one leaves out: its generator's 0.3 s `easeInOut`. */
const FOLLOW_TWEEN = { duration: 0.3, ease: Easing.easeInOut } as const

const PHYSICS_FIELDS = ["stiffness", "damping", "mass"] as const
const TIME_FIELDS = ["duration", "bounce", "visualDuration"] as const

/** A transition's fields that run it: all but its `type`, its `delay` (held outside) and its `velocity`. */
const RUN_FIELDS = (_: unknown, key: string): boolean => Bool.and(Bool.and(key !== "type", key !== "delay"), key !== "velocity")

/** Whether a spring's fields set it by time (#359): a time field, and no physics, which would win over it. */
const isTimed = (fields: Readonly<Record<string, unknown>>): boolean =>
  Bool.and(
    Arr.some(TIME_FIELDS, (key) => Object.hasOwn(fields, key)),
    Bool.not(Arr.some(PHYSICS_FIELDS, (key) => Object.hasOwn(fields, key))),
  )

/** A follow's runs, worked out once from its transition (#441). */
interface FollowPlan {
  /** A run from `from`, at `velocity`, toward `target()`. */
  readonly start: (from: number, velocity: number, target: () => number) => (dt: number) => Frame.Frame<number>
  /**
   * Whether a change while it runs starts it again from where it's reached, as Motion's: all but a
   * spring with no `delay` and no `velocity`, which steers toward the source, read every step.
   */
  readonly restarts: boolean
  /** The velocity a run starts from, given the one it carries: the transition's, when it gives one. */
  readonly velocityOf: (carried: number) => number
}

/** A follow's plan from its transition: what it leaves out filled as Motion's follower does. */
const planOf = (transition: FollowTransition): FollowPlan => {
  const fields = Rec.filter(transition as Readonly<Record<string, unknown>>, Predicate.isNotUndefined)
  const delay = UndefinedOr.match(fields.delay as number | undefined, { onUndefined: () => 0, onDefined: identity })
  const given = fields.velocity as number | undefined
  const velocityOf = UndefinedOr.match(given, { onUndefined: () => identity<number>, onDefined: (v) => (): number => v })
  const own = Rec.filter(fields, RUN_FIELDS)
  // Each change holds it where it is for `delay`, then it goes on: a run built again at each.
  const held = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>): Machine.Machine<F> => Machine.delay(machine, delay)
  return Match.value(fields.type).pipe(
    Match.when("tween", (): FollowPlan => {
      const tween = { ...FOLLOW_TWEEN, ...own } as Machine.TweenOptions
      return { start: (from, _, target) => held(Machine.tween(from, target(), tween)).start(), restarts: true, velocityOf }
    }),
    Match.when("inertia", (): FollowPlan => {
      const inertia = { ...FOLLOW_REST, ...own } as Machine.InertiaOptions
      return { start: (from, velocity) => held(Machine.inertia(from, velocity, inertia)).start(), restarts: true, velocityOf }
    }),
    Match.orElse((): FollowPlan => {
      const physics = Bool.match(isTimed(own), { onTrue: () => ({}), onFalse: () => MOTION_PHYSICS })
      const spring = { ...FOLLOW_REST, ...physics, ...own } as Machine.SpringOptions
      return Bool.match(Bool.and(delay === 0, Predicate.isUndefined(given)), {
        onTrue: (): FollowPlan => ({ start: (from, velocity, target) => Machine.chase(target, { ...spring, from, velocity }).start(), restarts: false, velocityOf }),
        onFalse: (): FollowPlan => ({
          start: (from, velocity, target) => held(Machine.spring(target(), { ...spring, from, velocity })).start(),
          restarts: true,
          velocityOf,
        }),
      })
    }),
  )
}

/** A Frame's velocity: a tween's is none, as Motion's follower drops it. Per frame: a property read and a guard. */
const velocityOfFrame = (frame: Frame.Frame<number>): number => {
  const velocity = (frame as Partial<Frame.Physics>).velocity
  if (Predicate.isUndefined(velocity)) return 0
  return velocity
}

const FOLLOW_SPAN: Machine.Span = { name: "wardic.follow", attributes: {} }

/**
 * A value that follows `source` on a transition, as Motion's `followValue`: it starts where the source
 * is, and from each change on, a run toward the source runs on the Frame loop until it rests there;
 * nothing runs while it rests.
 * - **A spring** with no `delay` or `velocity` steers toward the source, read afresh every step, keeping
 *   its velocity through a change.
 * - **Anything else** starts again at the step after a change, from where it has got to: a tween with
 *   its full duration, an inertia gliding again, a spring with the transition's `velocity`, or its own.
 *   Several changes in one frame start it once.
 * - **A `delay`** holds it where it is at every change, then it goes on toward the latest: a source
 *   that never rests doesn't move it until it does.
 *
 * At its source already, a change starts nothing. With `skipInitialAnimation`, the source's first change
 * is a `jump`; with `skipAnimations`, or while `skipped()` says so, every change is. Its run and its
 * subscription end with the Scope.
 *
 * @example
 * const eased = yield* LiveValue.follow(target, { type: "tween", duration: 0.4, ease: "easeOut" })
 */
// #441; an inertia's target unread (#435); several changes start it once, as Motion's `FollowAnimation`
// retargets at its next tick; `skipped()` is a binding's subtree setting, read at each change (#468). The
// Atom is held in the registry until the Scope ends, and after it only while subscribed.
export const follow: (
  source: Atom.Atom<number>,
  options?: FollowOptions,
  skipped?: () => boolean,
) => Effect.Effect<Followed, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> = Effect.fnUntraced(
  function* (source: Atom.Atom<number>, options: FollowOptions = {}, skipped: () => boolean = constFalse) {
    const registry = yield* AtomRegistry.AtomRegistry
    const { skipInitialAnimation, skipAnimations, ...transition } = options
    const plan = planOf(transition as FollowTransition)
    const skips = Bool.match(skipAnimations === true, { onTrue: () => constTrue, onFalse: () => skipped })
    // Mounted for the Scope, not kept alive: a kept-alive Atom's node never leaves the registry.
    const out = Atom.make(registry.get(source))
    const unmount = registry.mount(out)
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    let token = Supersede.make()
    let velocity = 0
    // Whether a run follows the source now: a change while it does costs a check, nothing built.
    let running = false
    // A change since the run's last step, for a plan that starts again at each: taken at its next step.
    let changed = false
    // Whether the source's next change is a jump: its first, with `skipInitialAnimation`.
    let skipping = skipInitialAnimation === true
    const target = (): number => registry.get(source)
    /** One run: the plan's, from where `out` is, started again from where it's reached at the step after a change. */
    const machine = Machine.make({
      settles: false,
      span: FOLLOW_SPAN,
      start: () => {
        let step = plan.start(registry.get(out), plan.velocityOf(velocity), target)
        // Per frame (ADR-0025): a check; a run built only at a change.
        return (dt) => {
          const frame = step(dt)
          if (Bool.not(changed)) return frame
          changed = false
          const reached = velocityOfFrame(frame)
          step = plan.start(frame.value, plan.velocityOf(reached), target)
          return { value: frame.value, velocity: reached, done: false }
        }
      },
    })
    /** Follow the source's change from where `out` is, until it rests. */
    const onChange = (): void => {
      // The callback only once a skip isn't already under way (#460, Q8).
      if (skipping || skips()) {
        skipping = false
        jumpIn(registry, out, registry.get(source))
        return
      }
      // A steering spring reads the source itself; any other run starts again at its next step.
      if (running) {
        changed = plan.restarts
        return
      }
      // At its source already: nothing to start, as Motion's.
      if (registry.get(out) === registry.get(source)) return
      running = true
      changed = false
      token = Supersede.make()
      const ending = token
      run(
        machine.pipe(
          Machine.run(
            (frame) => {
              registry.set(out, frame.value)
              velocity = velocityOfFrame(frame)
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
    const unsubscribe = registry.subscribe(source, onChange)
    // A jump of `out`: the run ends where it's set, with no velocity, and the next change follows from there.
    const unhear = onJump(registry, out, () => {
      running = false
      changed = false
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
    return out as unknown as Followed
  })

/**
 * A value that follows `source` on a spring, as Motion's `useSpring`: `follow`'s spring, `options` a
 * spring's, and Motion's follower's for what it leaves out: 100 / 10 / 1 unless it's set by time, at
 * rest within 0.001 and below 0.01 a second.
 *
 * @example
 * const smooth = yield* LiveValue.spring(scrollYProgress, { visualDuration: 0.3 })
 */
// #441.
export const spring = (
  source: Atom.Atom<number>,
  options: SpringOptions = {},
  skipped: () => boolean = constFalse,
): Effect.Effect<Followed, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> =>
  follow(source, { ...options, type: "spring" }, skipped)

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
 * A container's scroll as Motion's four values, as `useScroll`: how far it's scrolled on each axis, and
 * the progress through its range, or, with a `target` or an `offset`, through the offsets the target
 * passes on `axis`. Each is set within the scroll's own event, so a value derived from one is written in
 * the frame that shows the scroll. The container's listeners are held while the Scope is.
 *
 * @example
 * const { scrollYProgress } = yield* LiveValue.scroll({ container })
 */
// #234, ADR-0043 *Amendment (#233, #234)*: derived from the Environment's `ScrollSource` (the Probe's
// `scroll` until #518).
export const scroll: (options?: ScrollSource.Options) => Effect.Effect<ScrollValues, never, ScrollSource.ScrollSource | Scope.Scope> =
  Effect.fnUntraced(function* (options: ScrollSource.Options = {}) {
    const source = yield* ScrollSource.ScrollSource
    const info = yield* source.scroll(options)
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
 * How fast `source` is changing, in its units a second, as Motion's `useVelocity`: 0 to begin with, and
 * from each change on, each frame's change over the frame's time, until a frame finds no change, sets 0
 * and stops. Nothing runs while the source rests. A velocity is a value too: `velocity(velocity(x))` is
 * acceleration. Its run ends with the Scope.
 *
 * @example
 * const speed = yield* LiveValue.velocity(scrollY)
 */
// Each tick's `dt` is clamped at `Machine.MAX_DT`, as every run's is. "Since the end of the tick before",
// read by an `afterTick` hook, not the run's own last read: a run started inside a tick takes its first
// step at the next one, and would otherwise count two frames' change over one `dt`.
export const velocity: (source: Atom.Atom<number>) => Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> = Effect.fnUntraced(
  function* (source: Atom.Atom<number>) {
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
 * Milliseconds since it started, as Motion's `useTime`: wall time, minutes the app spent hidden included. It
 * keeps the Clock ticking every frame while it runs; its run ends with the Scope.
 *
 * @example
 * const rotate = yield* LiveValue.transform(yield* LiveValue.time(), [0, 4000], [0, 360], { clamp: false })
 */
// A run on the Frame loop that never settles, adding each tick's `dt` as the Clock gives it, unclamped.
export const time: () => Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> = Effect.fnUntraced(
  function* () {
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

/** The range `eachFrame`'s delta is held to, in ms: Motion's frame loop's (`maxElapsed`, and 1 at least). */
const FRAME_DELTA = { minimum: 1, maximum: 40 } as const

/**
 * Calls `callback` every frame with the frame's time and delta, in milliseconds, as Motion's
 * `useAnimationFrame`: for what a frame draws itself, a canvas or a 3D scene. It keeps the Clock ticking
 * every frame while it runs; its run ends with the Scope.
 *
 * - **`time`** is 0 at its first frame, then wall time, as `time`'s.
 * - **`delta`** is the frame's own, held to 1–40 ms, so the first frame after the app was hidden steps
 *   40 ms, not minutes.
 *
 * A throw from `callback` ends the run: a binding catches it first.
 *
 * @example
 * yield* LiveValue.eachFrame((time) => draw(context, time))
 */
// #443. A run's first frame after the Clock wakes is the Clock's nominal frame, 16.7 ms, as Motion's is.
// A throw is a run's defect (ADR-0027, decision 7).
export const eachFrame: (callback: (time: number, delta: number) => void) => Effect.Effect<void, never, FrameLoop.FrameLoop | Scope.Scope> = Effect.fnUntraced(
  function* (callback: (time: number, delta: number) => void) {
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    const token = Supersede.make()
    const frames = numberMachine("wardic.eachFrame", false, () => {
      let ms = 0
      let first = true
      return (dt) => {
        // Its first frame is 0, as Motion's `timestamp - initialTimestamp` is.
        if (!first) ms += dt * 1000
        first = false
        // Plain Math: a step runs every frame for each `eachFrame`, and `Num.clamp` costs 5× (#618, H1).
        callback(ms, Math.min(Math.max(dt * 1000, FRAME_DELTA.minimum), FRAME_DELTA.maximum))
        return { value: ms, done: false }
      }
    })
    run(frames.pipe(Machine.run(constUndefined, { supersede: token })))
    yield* Effect.addFinalizer(() => Effect.sync(() => Supersede.end(token)))
  })

