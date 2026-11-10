/**
 * `createBatch`'s work (#665), Solid-free: one core Batch for a collection of elements, its members
 * entered as their elements arrive, and each change of their targets one Retarget of them all. Both
 * bindings' `createBatch` build on it, each tracking its config's `animate` with its own Solid.
 *
 * - **Its keys** are the ones its members' first targets and starts give: fixed when it's made, as a
 *   Batch's are (ADR-0069, decision 10). A key a later `animate` gives is an error naming it.
 * - **A member** is an element given to its handle's `ref`. It starts from `initial`, else at each
 *   key's identity, as an element does with no style of its own; with `initial: false`, at its target.
 * - **A change** turns every member toward its targets in one Retarget: a member whose targets are
 *   unchanged gets nothing, and `delay: stagger()` counts the members it moves (ADR-0069, *Amendment
 *   (#665)*).
 * - **Its transitions** are a Wardic element's, read as each change starts: the config's, else the
 *   nearest `WardicConfig`'s, each key's own entry, the Environment's Default transition for a key
 *   without one, reduced motion's Snap for a positional key, and `skipAnimations`.
 *
 * @module
 */
// ADR-0070 decisions 10–15 and *Amendment (#665)*. The DOM's writer, imported here so an app that never
// makes a Batch ships none of it (ADR-0070, *Amendment (#665)*).
import * as Batch from "@wardic/core/Batch"
import * as BaseValue from "@wardic/core/BaseValue"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as DomBatchWriter from "@wardic/dom/DomBatchWriter"
import * as Svg from "@wardic/dom/Svg"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition } from "./config.ts"
import { type Run, runOf, transitionForKey } from "./retarget-legs.ts"
import type { WardicRuntime } from "./runtime.ts"

/** The keys a Batch's members animate on the DOM: the transforms and `opacity`, as numbers. */
export type WardicBatchKey =
  | "x" | "y" | "z" | "translateX" | "translateY" | "translateZ"
  | "scale" | "scaleX" | "scaleY"
  | "rotate" | "rotateX" | "rotateY" | "rotateZ"
  | "skewX" | "skewY"
  | "opacity"

/** A member's values: numbers on its keys, in `px` for a move, degrees for a turn, unitless for a scale and `opacity`. */
export type WardicBatchValues = { readonly [K in WardicBatchKey]?: number }

/**
 * A Batch's transition: a Wardic element's, its `delay` seconds for every member or a `stagger()`,
 * which counts the members each change moves.
 */
export type WardicBatchTransition = WardicTransition extends infer T
  ? T extends unknown ? Omit<T, "delay"> & { readonly delay?: number | ((index: number, total: number) => number) } : never
  : never

/** A Batch's landing: how many members set off in the flight that landed. */
export interface WardicBatchLanding {
  readonly moved: number
}

/** What both bindings' `createBatch` take. */
export interface BatchConfig {
  /** How many members it has: read once. */
  readonly count: number
  /** Where each member starts: values, a function of its index, or `false` to start at its targets. */
  readonly initial?: false | WardicBatchValues | ((i: number) => WardicBatchValues)
  /** Each member's targets, by its index: tracked, so a change turns every member once. */
  readonly animate: (i: number) => WardicBatchValues
  /** How they move: else the nearest `WardicConfig`'s, else each key's Default transition. */
  readonly transition?: WardicBatchTransition
}

/** What a Batch needs from its provider. */
export interface BatchEnv {
  readonly runtime: WardicRuntime
  readonly reducedMotion: () => boolean
  readonly skipAnimations: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
  /** The nearest `WardicConfig`'s transition, read as each change starts. */
  readonly configTransition: () => WardicTransition | undefined
}

/** What a Batch tells its binding: a flight's start, and its landing. */
export interface BatchHooks {
  readonly started: () => void
  readonly landed: (landing: WardicBatchLanding) => void
}

/** A Batch bound to its config: its targets, read by the binding's tracking, and what it does with them. */
export interface BatchBinding {
  /** Every member's targets, member by member in key order, `NaN` for a key a member's targets leave out. */
  readonly targetsOf: () => Float64Array
  /** A change: every member turned toward `targets`. */
  readonly apply: (targets: Float64Array) => void
  /** Member `i`'s `ref`: one function a member. */
  readonly refOf: (i: number) => (el: Element) => void
  /** The Batch's run ended, and no member drawn again. */
  readonly dispose: () => void
}

/** A Batch whose keys the DOM can't draw, or a member it hasn't got: what the error says. */
const fail = (message: string): never => {
  throw new Error(`createBatch: ${message}`)
}

/** Each key's identity: a transform's, and `opacity`'s 1, an element's own with no style of its own. */
const identityOf = (key: string): number => UndefinedOr.match(BaseValue.TRANSFORM_IDENTITY[key], { onUndefined: () => 1, onDefined: (identity) => identity })

/** `initial` for member `i`, as values, or `undefined` for none. */
const initialOf = (config: BatchConfig, i: number): WardicBatchValues | undefined => {
  const initial = config.initial
  if (Predicate.isUndefined(initial) || initial === false) return undefined
  if (Predicate.isFunction(initial)) return initial(i)
  return initial
}

/** The keys a Batch's members give, in the order they first appear: what its first targets and starts name. */
const keysOf = (config: BatchConfig): ReadonlyArray<string> => {
  const seen = new Set<string>()
  // Per member at creation, once (#665): a loop over its targets' keys and its start's.
  for (let i = 0; i < config.count; i++) {
    for (const key in config.animate(i)) seen.add(key)
    const start = initialOf(config, i)
    if (Predicate.isNotUndefined(start)) for (const key in start) seen.add(key)
  }
  return Arr.fromIterable(seen)
}

/** One change that lands every key at once: `skipAnimations`'. */
const INSTANT: Batch.Transition = { type: "tween", duration: 0 }

/** Reduced motion's Snap after `delay`: a 0 s tween, kept by its delay so its keys share one. */
// Module state (#460, Q7): a cache built once, keyed by what it caches.
const SNAPS = new Map<number, Batch.Transition>()

const snapAfter = (delay: number): Batch.Transition => {
  const known = SNAPS.get(delay)
  if (Predicate.isNotUndefined(known)) return known
  const made: Batch.Transition = { type: "tween", duration: 0, delay }
  SNAPS.set(delay, made)
  return made
}

/** Each transition without its `delay`, which a change gives every member, staggered or not: one object each. */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const UNDELAYED = new WeakMap<object, WardicTransition>()

const undelayed = (given: WardicBatchTransition | WardicTransition): WardicTransition => {
  const known = UNDELAYED.get(given)
  if (Predicate.isNotUndefined(known)) return known
  const made = { ...given, delay: undefined } as unknown as WardicTransition
  UNDELAYED.set(given, made)
  return made
}

/** A key's transition as a Batch runs it: its run, which can't be an inertia or repeat. */
const batchRunOf = (run: Run, key: string): Batch.Transition => {
  if (run.type === "inertia") fail(`"${key}" has an inertia transition, which a Batch can't run: give it a spring or a tween`)
  if (Predicate.hasProperty(run, "repeat")) fail(`"${key}"'s transition repeats, which a Batch can't run`)
  return run as Batch.Transition
}

/**
 * Each key's transition for a change, by its index: its own, a Snap's under reduced motion for a
 * positional key, or `undefined` for its Default transition, which the member's target decides.
 */
const plannedOf = (env: BatchEnv, keys: ReadonlyArray<string>, given: WardicTransition | undefined, reduced: boolean): ReadonlyArray<Batch.Transition | undefined> =>
  Arr.map(keys, (key) => {
    const run = runOf(transitionForKey(given, key))
    const delay = UndefinedOr.match(run, { onUndefined: () => 0, onDefined: (defined) => UndefinedOr.match(defined.delay, { onUndefined: () => 0, onDefined: (seconds) => seconds }) })
    if (reduced && env.positionalKeys.isPositional(key)) return snapAfter(delay)
    if (Predicate.isUndefined(run)) return undefined
    return batchRunOf(run, key)
  })

/** A change's delay: its transition's, seconds or a `stagger()` over the members it moves. */
const delayOf = (given: WardicBatchTransition | WardicTransition | undefined): Batch.RetargetOptions["delay"] =>
  UndefinedOr.match(given, { onUndefined: () => undefined, onDefined: (transition) => transition.delay as Batch.RetargetOptions["delay"] })

/**
 * A Batch for `config`'s members, under `env`'s provider: its writer the DOM's. The binding tracks
 * {@link BatchBinding.targetsOf} and hands each new value to {@link BatchBinding.apply}.
 */
export const bindBatch = (env: BatchEnv, config: BatchConfig, hooks: BatchHooks): BatchBinding => {
  const count = config.count
  const keys = keysOf(config)
  const stride = keys.length
  const keyIndex: ReadonlyMap<string, number> = new Map(Arr.map(keys, (key, k) => [key, k] as const))

  /** Every member's targets now: member by member in key order. */
  const targetsOf = (): Float64Array => {
    const targets = new Float64Array(count * stride).fill(Number.NaN)
    // Per member per key at a change, the Batch's own loop (ADR-0025, *Amendment (#665)*).
    for (let i = 0; i < count; i++) {
      const values = config.animate(i) as Readonly<Record<string, number | undefined>>
      for (const key in values) {
        const k = keyIndex.get(key)
        if (Predicate.isUndefined(k)) return fail(`member ${i}'s targets give "${key}", which its first targets didn't: a Batch's keys are fixed when it's made`)
        const value = values[key]
        if (Predicate.isNumber(value)) targets[i * stride + k] = value
      }
    }
    return targets
  }

  let current = targetsOf()
  // Its own transitions, each key's as it is at creation, so the members a change gives them step by one
  // matrix while they share one (ADR-0069, *Amendment (#665)*): the Default transition toward the first
  // member's target for a key without one.
  const configuredOf = (): WardicTransition | undefined =>
    UndefinedOr.match(config.transition as WardicTransition | undefined, { onUndefined: env.configTransition, onDefined: (given) => given })
  const ownPlan = plannedOf(env, keys, UndefinedOr.map(configuredOf(), undelayed), false)
  const own: Record<string, Batch.Transition> = {}
  Arr.forEach(keys, (key, k) => {
    own[key] = UndefinedOr.match(ownPlan[k], {
      onDefined: (planned) => planned,
      onUndefined: () => {
        let target = current[k]
        if (Number.isNaN(target)) target = identityOf(key)
        return env.defaultTransition.transitionFor(key, target) as Batch.Transition
      },
    })
  })
  const batch = Batch.make({ keys, writer: DomBatchWriter.writer, transition: own, capacity: Math.max(1, count) })
  // Each member's slot by its index (-1 before its element arrives), each slot's member, and its element.
  const slotOf = new Int32Array(count).fill(-1)
  const memberOf: Array<number> = []
  const elementOf: Array<Element | undefined> = []
  const entered: Array<number> = []
  const targetOf = (slot: number, k: number): number => current[memberOf[slot] * stride + k]

  /** Member `i`'s start: its `initial` over each key's identity, or, with `initial: false`, its targets. */
  const startOf = (i: number): Record<string, number> => {
    const start: Record<string, number> = {}
    const given = initialOf(config, i) as Readonly<Record<string, number | undefined>> | undefined
    Arr.forEach(keys, (key, k) => {
      const target = current[i * stride + k]
      let value = identityOf(key)
      if (config.initial === false && !Number.isNaN(target)) value = target
      const own = UndefinedOr.map(given, (values) => values[key])
      if (Predicate.isNumber(own)) value = own
      start[key] = value
    })
    return start
  }

  // The runs it forked, interrupted when it's disposed; whether a flight is on, and the members it set off.
  const fibers = new Set<Fiber.Fiber<void>>()
  let flying = false
  let moved = 0
  let disposed = false

  /** A flight lands once a run ends with nothing moving: a run forked while one ran ends at once. */
  const ended = (): void => {
    if (!flying || Batch.isMoving(batch)) return
    flying = false
    hooks.landed({ moved })
  }

  /** After a change: a flight's start, if it set one off, and a run, which does nothing while one runs. */
  const wake = (setOff: number): void => {
    if (!Batch.isMoving(batch)) return
    if (!flying) {
      flying = true
      moved = 0
      hooks.started()
    }
    moved = moved + setOff
    const fiber = env.runtime.runFork(Effect.ensuring(Batch.run(batch), Effect.sync(() => {
      fibers.delete(fiber)
      ended()
    })))
    fibers.add(fiber)
  }

  /** The change for `slots` now: their targets, with this moment's transitions. */
  const change = (slots: ReadonlyArray<number>): void => {
    if (slots.length === 0) return
    const configured = configuredOf()
    if (env.skipAnimations() || UndefinedOr.map(configured, (given) => given.skipAnimations) === true) {
      wake(Batch.retarget(batch, slots, targetOf, { transition: INSTANT }))
      return
    }
    const reduced = env.reducedMotion() && UndefinedOr.map(configured, (given) => given.respectReducedMotion) !== false
    const planned = plannedOf(env, keys, UndefinedOr.map(configured, undelayed), reduced)
    const transition = (slot: number, k: number): Batch.Transition => {
      const own = planned[k]
      if (Predicate.isNotUndefined(own)) return own
      return env.defaultTransition.transitionFor(keys[k], targetOf(slot, k)) as Batch.Transition
    }
    const delay = delayOf(configured)
    if (Predicate.isUndefined(delay)) {
      wake(Batch.retarget(batch, slots, targetOf, { transition }))
      return
    }
    wake(Batch.retarget(batch, slots, targetOf, { transition, delay }))
  }

  // Elements that arrived this task: entered at once, turned toward their targets together at its end.
  let arrived: Array<number> = []
  const flushArrivals = (): void => {
    const slots = arrived
    arrived = []
    if (disposed) return
    change(slots)
  }

  const arrive = (i: number, el: Element): void => {
    if (disposed) return
    if (!Number.isInteger(i) || i < 0 || i >= count) fail(`it has no member ${i}: its count is ${count}`)
    if (elementOf[i] === el) return
    const slot = slotOf[i]
    let start = startOf(i)
    // A new element for a member: it goes on from where the one before it was.
    if (slot !== -1) {
      start = {}
      Arr.forEach(keys, (key) => {
        start[key] = Batch.get(batch, slot, key)
      })
      Batch.leave(batch, slot)
    }
    const entering = Batch.enter(batch, el, start)
    slotOf[i] = entering
    memberOf[entering] = i
    elementOf[i] = el
    if (slot === -1) entered.push(entering)
    // An element inside an `<svg>` turns about its own centre, as an HTML one does (as the renderer's).
    if (Svg.isInner(el)) {
      const style = (el as SVGElement).style
      style.setProperty("transform-box", "fill-box")
      style.setProperty("transform-origin", "50% 50%")
    }
    // Drawn at its start now; its move, with every member that arrives this task, at the task's end.
    DomBatchWriter.writer.forKeys(keys)(el, Float64Array.from(Arr.map(keys, (key) => start[key])), 0)
    if (arrived.length === 0) queueMicrotask(flushArrivals)
    arrived.push(entering)
  }

  const refs = Arr.makeBy(count, (i) => (el: Element) => arrive(i, el))

  return {
    targetsOf,
    apply: (targets) => {
      current = targets
      if (disposed) return
      change(entered)
    },
    refOf: (i) => {
      if (!Number.isInteger(i) || i < 0 || i >= count) return fail(`it has no member ${i}: its count is ${count}`)
      return refs[i]
    },
    dispose: () => {
      disposed = true
      Arr.forEach(Arr.fromIterable(fibers), (fiber) => fiber.interruptUnsafe())
      fibers.clear()
    },
  }
}

/** The CSS properties a member's keys draw, which its element's own `style` leaves to the Batch. */
const DRAWN: ReadonlySet<string> = new Set(["transform", "opacity"])

/** An element's own `style` as a member's handle passes it on: without the properties its Batch draws. */
export const memberStyleOf = <S>(style: S): S => {
  if (!Predicate.isObject(style)) return style
  const kept: Record<string, unknown> = {}
  Arr.forEach(Object.keys(style), (name) => {
    if (DRAWN.has(name)) return
    kept[name] = (style as Readonly<Record<string, unknown>>)[name]
  })
  return kept as S
}
