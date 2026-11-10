/**
 * `createBatch`'s work (#665), Solid-free: one core Batch for a collection of elements, its members
 * entered as their elements arrive, and each change of their targets one Retarget of them all. Both
 * bindings' `createBatch` build on it, each tracking its config's `animate` with its own Solid.
 *
 * - **Its keys** are the ones its members' first targets and starts give: fixed when it's made, as a
 *   Batch's are (ADR-0069, decision 10). A key a later `animate` gives is an error naming it.
 * - **A member** is an element given to its handle's `ref`. It starts from `initial`, else at each
 *   key's identity, as an element does with no style of its own; with `initial: false`, at its target.
 *   An element its framework makes again for the same member carries on where the last one was.
 * - **A change** turns every member toward its targets in one Retarget: a member whose targets are
 *   unchanged gets nothing, and `delay: stagger()` counts the members it moves (ADR-0069, *Amendment
 *   (#665)*).
 * - **Its transitions** are a Wardic element's, read as each change starts: the config's, else the
 *   nearest `WardicConfig`'s; each key's own entry and its `delay`; the Environment's Default
 *   transition for a key without one; reduced motion's Snap for a positional key; `skipAnimations`.
 *
 * @module
 */
// ADR-0070 decisions 10–15 and *Amendment (#665)*. The DOM's writer, imported here so an app that never
// makes a Batch ships none of it (ADR-0070, *Amendment (#665)*).
import * as Batch from "@wardic/core/Batch"
import * as BaseValue from "@wardic/core/BaseValue"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as Playback from "@wardic/core/Playback"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as DomBatch from "@wardic/dom/DomBatch"
import * as Svg from "@wardic/dom/Svg"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Fiber from "effect/Fiber"
import * as Iter from "effect/Iterable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
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
 * A Batch's transition: a Wardic element's, its `delay` seconds, or a `stagger()`, which holds each
 * member by its place among the members a change moves.
 */
export type WardicBatchTransition = WardicTransition extends infer T
  ? T extends unknown ? Omit<T, "delay"> & { readonly delay?: number | ((index: number, total: number) => number) } : never
  : never

/** A stop of a Batch's `animate` call: a number for every member, or a function of its index and the Batch's count. */
export type WardicBatchStop = number | ((i: number, n: number) => number)

/** A Batch's targets for an `animate` call, key by key: a stop, or two, the member's first and its target. */
export type WardicBatchTarget = { readonly [K in WardicBatchKey]?: WardicBatchStop | readonly [WardicBatchStop, WardicBatchStop] }

/** What `createAnimate`'s `animate` takes for a Batch: one, or a member's handle, `grid.at(i)`. */
export type WardicBatchSubject = { readonly at: (i: number, props?: never) => unknown } | { readonly ref: (el: never) => void }

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
  /** An element's own `style`, without the properties the Batch draws on it. */
  readonly styleOf: <Style>(style: Style) => Style
  /** An `animate` call's track over its members, or member `member`'s alone, driven by `head`. */
  readonly track: (call: BatchCall) => BatchTrack
  /** The Batch's run ended, and no member drawn again. */
  readonly dispose: () => void
}

/** An `animate` call of a Batch: its targets, its transition, its scope's settings, its Playhead and landing. */
export interface BatchCall {
  readonly target: WardicBatchTarget
  readonly transition: WardicTransition | undefined
  readonly reducedMotion: boolean
  readonly skipAnimations: boolean
  readonly head: Playback.Playhead
  readonly settled: () => void
  /** One member, by its index: else every member whose element has arrived. */
  readonly member: number | undefined
}

/** What an `animate` call's Playback controls act on: an Imperative track's shape (`spine.ts`). */
export interface BatchTrack {
  readonly run: () => void
  readonly stop: () => void
  readonly cancel: () => void
  readonly duration: () => number
}

/** Each Batch and member handle's binding, so `animate` knows them: a member's by its index. */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const SUBJECTS = new WeakMap<object, { readonly binding: BatchBinding; readonly member: number | undefined }>()

/** `handle` is `binding`'s Batch, for `animate`. */
export const registerBatch = (handle: object, binding: BatchBinding): void => {
  SUBJECTS.set(handle, { binding, member: undefined })
}

/** The binding `subject` is a Batch or member handle of, for `animate`; `undefined` for anything else. */
export const batchSubjectOf = (subject: unknown): { readonly binding: BatchBinding; readonly member: number | undefined } | undefined => {
  if (!Predicate.isObject(subject)) return undefined
  return SUBJECTS.get(subject)
}

/** The props an element gives a member's handle: its own `ref`, and its own `style`, as an object. */
export interface MemberProps<E extends Element, Style> {
  readonly ref?: (el: E) => void
  readonly style?: Style
}

/** A member's handle: spread onto its element. */
export interface Member<E extends Element, Style> {
  readonly ref: (el: E) => void
  readonly style?: Style | undefined
}

/** What an error about a Batch says. */
const fail = (message: string): never => {
  throw new Error(`createBatch: ${message}`)
}

/** Whether `i` is one of `count` members' indices. */
const isMember = (i: number, count: number): boolean => Number.isInteger(i) && i >= 0 && i < count

const noMember = (i: number, count: number): never => fail(`it has no member ${i}: its count is ${count}`)

/** Each key's identity: a transform's, and `opacity`'s 1, an element's own with no style of its own. */
// Per member per key at mount (#540): statements.
const identityOf = (key: string): number => {
  const identity = BaseValue.TRANSFORM_IDENTITY[key]
  if (Predicate.isUndefined(identity)) return 1
  return identity
}

/** `initial` for member `i`, as values, or `undefined` for none. */
const initialOf = (config: BatchConfig, i: number): Readonly<Record<string, unknown>> | undefined => {
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

/**
 * A Default transition held by a key's own `delay`, as a Wardic element's is when its transition gives
 * only a delay (ADR-0051): one object for each transition and delay, so the members on it share it.
 */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const DELAYED = new WeakMap<object, Map<number, Batch.Transition>>()

const delayedBy = (transition: Batch.Transition, delay: number): Batch.Transition => {
  if (delay === 0) return transition
  let byDelay = DELAYED.get(transition)
  if (Predicate.isUndefined(byDelay)) {
    byDelay = new Map()
    DELAYED.set(transition, byDelay)
  }
  const known = byDelay.get(delay)
  if (Predicate.isNotUndefined(known)) return known
  const made = { ...transition, delay } as Batch.Transition
  byDelay.set(delay, made)
  return made
}

/**
 * A transition without a `stagger()` delay, which a change gives each member by its place: one object
 * each. A `delay` in seconds stays, held by the keys the transition's own fields reach, as a Wardic
 * element's top-level delay is.
 */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const UNSTAGGERED = new WeakMap<object, WardicTransition>()

const unstaggered = (given: WardicBatchTransition | WardicTransition): WardicTransition => {
  if (!Predicate.isFunction(given.delay)) return given as WardicTransition
  const known = UNSTAGGERED.get(given)
  if (Predicate.isNotUndefined(known)) return known
  const made = { ...given, delay: undefined } as unknown as WardicTransition
  UNSTAGGERED.set(given, made)
  return made
}

/** A change's `stagger()` delay, for the members it moves; `undefined` for none. */
const staggerOf = (given: WardicTransition | undefined): ((rank: number, n: number) => number) | undefined => {
  if (Predicate.isUndefined(given)) return undefined
  const delay: unknown = given.delay
  if (Predicate.isFunction(delay)) return delay as (rank: number, n: number) => number
  return undefined
}

/** A key's transition as a Batch runs it: its run, which can't be an inertia or repeat. */
const batchRunOf = (run: Run, key: string): Batch.Transition => {
  if (run.type === "inertia") fail(`"${key}" has an inertia transition, which a Batch can't run: give it a spring or a tween`)
  if (Predicate.hasProperty(run, "repeat")) fail(`"${key}"'s transition repeats, which a Batch can't run`)
  return run as Batch.Transition
}

/** A change's plan for one key: its own transition, or `undefined` for its Default transition held by `delay`. */
interface KeyPlan {
  readonly own: Batch.Transition | undefined
  readonly delay: number
}

/**
 * Each key's plan for a change, by its index, as a Wardic element's keys run (#301): its entry, else
 * `default`, else the transition's own fields; reduced motion's Snap for a positional key that doesn't
 * opt out; its Default transition, held by its own `delay`, for a key whose transition isn't defined.
 */
// Once a change, per key.
const plannedOf = (env: BatchEnv, keys: ReadonlyArray<string>, given: WardicTransition | undefined, reduced: boolean): ReadonlyArray<KeyPlan> =>
  Arr.map(keys, (key): KeyPlan => {
    const transition = transitionForKey(given, key)
    let delay = 0
    let respects = true
    if (Predicate.isNotUndefined(transition)) {
      if (Predicate.isNumber(transition.delay)) delay = transition.delay
      respects = transition.respectReducedMotion !== false
    }
    if (reduced && respects && env.positionalKeys.isPositional(key)) return { own: snapAfter(delay), delay }
    const run = runOf(transition)
    if (Predicate.isUndefined(run)) return { own: undefined, delay }
    return { own: batchRunOf(run, key), delay }
  })

/** A server render's handle: the element's own props passed on, and nothing animates. */
export const serverHandle = <Style>() =>
  <E extends Element>(_: number, props?: MemberProps<E, Style>): Member<E, Style> => {
    if (Predicate.isUndefined(props)) return { ref: noop }
    return { ref: noop, style: props.style }
  }

const noop = (): void => {}

/** Member handles for `binding`: its `ref`, the element's own `ref` called beside it, and its own `style` kept. */
export const handlesOf = <Style>(binding: BatchBinding) =>
  <E extends Element>(i: number, props?: MemberProps<E, Style>): Member<E, Style> => {
    const handle = memberHandleOf<E, Style>(binding, i, props)
    // Known to `animate`, as member `i`'s.
    SUBJECTS.set(handle, { binding, member: i })
    return handle
  }

const memberHandleOf = <E extends Element, Style>(binding: BatchBinding, i: number, props: MemberProps<E, Style> | undefined): Member<E, Style> => {
  const ref = binding.refOf(i)
  if (Predicate.isUndefined(props)) return { ref }
  const own = props.ref
  return {
    ref: (el: E) => {
      ref(el)
      if (Predicate.isNotUndefined(own)) own(el)
    },
    style: binding.styleOf(props.style),
  }
}

/** The nearest `WardicConfig`'s transition, read as each change starts, from either binding's config value. */
export const configTransitionOf = (config: { readonly transition: () => WardicTransition | undefined } | undefined) => (): WardicTransition | undefined => {
  if (Predicate.isUndefined(config)) return undefined
  return config.transition()
}

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
      const values = config.animate(i) as Readonly<Record<string, unknown>>
      for (const key in values) {
        const k = keyIndex.get(key)
        if (Predicate.isUndefined(k)) return fail(`member ${i}'s targets give "${key}", which its first targets didn't: a Batch's keys are fixed when it's made`)
        const value = values[key]
        if (Predicate.isNumber(value)) {
          targets[i * stride + k] = value
          continue
        }
        if (Predicate.isNotUndefined(value)) fail(`member ${i}'s "${key}" is ${JSON.stringify(value)}: a Batch's targets are numbers, one each`)
      }
    }
    return targets
  }

  let current = targetsOf()
  const configuredOf = (): WardicTransition | undefined => {
    const given = config.transition as WardicTransition | undefined
    if (Predicate.isNotUndefined(given)) return given
    return env.configTransition()
  }
  /** A key's Default transition toward `target`. */
  const defaultFor = (k: number, target: number): Batch.Transition => env.defaultTransition.transitionFor(keys[k], target) as Batch.Transition

  // Its own transitions, each key's as it is at creation, so the members a change gives them step by one
  // matrix while they share one (ADR-0069, *Amendment (#665)*): the Default transition toward the first
  // member's target for a key without one.
  const ownPlan = plannedOf(env, keys, UndefinedOr.map(configuredOf(), unstaggered), false)
  const own: Record<string, Batch.Transition> = {}
  Arr.forEach(keys, (key, k) => {
    const plan = ownPlan[k]
    if (Predicate.isNotUndefined(plan.own)) {
      own[key] = plan.own
      return
    }
    let target = current[k]
    if (Number.isNaN(target)) target = identityOf(key)
    own[key] = delayedBy(defaultFor(k, target), plan.delay)
  })
  const batch = Batch.make({ keys, writer: DomBatch.writer, transition: own, capacity: Math.max(1, count) })
  // The writer's write for these keys, built once: an arriving element is drawn with it at once.
  const write = DomBatch.writer.forKeys(keys)

  // Each member's slot by its index (-1 before its element arrives), each slot's member, and its element.
  const slotOf = new Int32Array(count).fill(-1)
  const memberOf: Array<number> = []
  const elementOf: Array<Element | undefined> = []
  const entered: Array<number> = []
  const targetOf = (slot: number, k: number): number => current[memberOf[slot] * stride + k]

  /** Member `i`'s start: its `initial` over each key's identity, or, with `initial: false`, its targets. */
  // Per member at mount (#540): statements.
  const startOf = (i: number): Record<string, number> => {
    const start: Record<string, number> = {}
    const given = initialOf(config, i)
    Arr.forEach(keys, (key, k) => {
      const target = current[i * stride + k]
      let value = identityOf(key)
      if (config.initial === false && !Number.isNaN(target)) value = target
      if (Predicate.isNotUndefined(given)) {
        const own = given[key]
        if (Predicate.isNumber(own)) value = own
        if (Predicate.isNotUndefined(own) && !Predicate.isNumber(own)) fail(`member ${i}'s "${key}" starts at ${JSON.stringify(own)}: a Batch's values are numbers`)
      }
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
    if (disposed) return
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
    // Heard by an observer, not an `Effect.ensuring`: one primitive fewer at each change (#665's profile).
    const fiber = env.runtime.runFork(Batch.run(batch))
    fibers.add(fiber)
    fiber.addObserver(() => {
      fibers.delete(fiber)
      ended()
    })
  }

  /**
   * A change's transitions: one per key, by its name, when every key has its own; else a function of
   * a member's slot, for the keys on their Default transition, which each member's target decides.
   */
  // A function called per member's key cost a change at 1,000 members a call each (#665's profile).
  const transitionOf = (planned: ReadonlyArray<KeyPlan>): Batch.Transitions | ((slot: number, k: number) => Batch.Transition) => {
    if (Arr.every(planned, (plan) => Predicate.isNotUndefined(plan.own))) {
      const byKey: Record<string, Batch.Transition> = {}
      Arr.forEach(keys, (key, k) => {
        byKey[key] = UndefinedOr.getOrThrow(planned[k].own)
      })
      return byKey
    }
    return (slot, k) => {
      const plan = planned[k]
      if (Predicate.isNotUndefined(plan.own)) return plan.own
      return delayedBy(defaultFor(k, targetOf(slot, k)), plan.delay)
    }
  }

  /** The change for `slots` now: their targets, with this moment's transitions. */
  const change = (slots: ReadonlyArray<number>): void => {
    if (slots.length === 0) return
    const configured = configuredOf()
    if (env.skipAnimations() || UndefinedOr.map(configured, (given) => given.skipAnimations) === true) {
      wake(Batch.retarget(batch, slots, targetOf, { transition: INSTANT }))
      return
    }
    const reduced = env.reducedMotion()
    const transition = transitionOf(plannedOf(env, keys, UndefinedOr.map(configured, unstaggered), reduced))
    const delay = staggerOf(configured)
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

  /** `el` drawn now at `values`, one per key, and turned about its own centre inside an `<svg>`, as the renderer's. */
  const drawNow = (el: Element, values: ReadonlyArray<number>): void => {
    if (Svg.isInner(el)) {
      const style = (el as SVGElement).style
      style.setProperty("transform-box", "fill-box")
      style.setProperty("transform-origin", "50% 50%")
    }
    write(el, Float64Array.from(values), 0)
  }

  const arrive = (i: number, el: Element): void => {
    if (disposed) return
    if (!isMember(i, count)) noMember(i, count)
    if (elementOf[i] === el) return
    elementOf[i] = el
    const slot = slotOf[i]
    // A new element for a member: it takes the member over, its values, speed and delays as they are.
    if (slot !== -1) {
      Batch.replace(batch, slot, el)
      drawNow(el, Arr.map(keys, (key) => Batch.get(batch, slot, key)))
      return
    }
    const start = startOf(i)
    const entering = Batch.enter(batch, el, start)
    slotOf[i] = entering
    memberOf[entering] = i
    entered.push(entering)
    // Drawn at its start now; its move, with every member that arrives this task, at the task's end.
    drawNow(el, Arr.map(keys, (key) => start[key]))
    if (arrived.length === 0) queueMicrotask(flushArrivals)
    arrived.push(entering)
  }

  const refs = Arr.makeBy(count, (i) => (el: Element) => arrive(i, el))

  // The CSS properties the Batch draws, which an element's own `style` leaves to it.
  const drawn: ReadonlySet<string> = new Set([
    ...Arr.filter(["transform"], () => Arr.some(keys, (key) => key !== "opacity")),
    ...Arr.filter(["opacity"], () => keyIndex.has("opacity")),
  ])

  /** A stop's value for member `i`. */
  const valueOf = (stop: WardicBatchStop, i: number): number => {
    if (Predicate.isFunction(stop)) return stop(i, count)
    return stop
  }

  /** An `animate` call's track: its members' targets and first stops by key, its own transitions, its Playhead. */
  const track = (call: BatchCall): BatchTrack => {
    const tos: Array<WardicBatchStop | undefined> = Arr.map(keys, () => undefined)
    const froms: Array<WardicBatchStop | undefined> = Arr.map(keys, () => undefined)
    Arr.forEach(Object.keys(call.target), (key) => {
      const k = keyIndex.get(key)
      if (Predicate.isUndefined(k)) return fail(`an animate call gives "${key}", which isn't one of the Batch's keys (${keys.join(", ")})`)
      const value: unknown = (call.target as Readonly<Record<string, unknown>>)[key]
      if (Predicate.isNumber(value) || Predicate.isFunction(value)) {
        tos[k] = value as WardicBatchStop
        return
      }
      if (Arr.isArray(value) && value.length === 2) {
        froms[k] = value[0] as WardicBatchStop
        tos[k] = value[1] as WardicBatchStop
        return
      }
      return fail(`an animate call's "${key}" is ${JSON.stringify(value)}: a Batch takes a number or a function, or two of them, its first and its target`)
    })
    const callTarget = (slot: number, k: number): number => {
      const to = tos[k]
      if (Predicate.isUndefined(to)) return Number.NaN
      return valueOf(to, memberOf[slot])
    }
    const callFrom = (slot: number, k: number): number => {
      const from = froms[k]
      if (Predicate.isUndefined(from)) return Number.NaN
      return valueOf(from, memberOf[slot])
    }
    let slots: ReadonlyArray<number> = [...entered]
    const member = call.member
    if (Predicate.isNotUndefined(member)) {
      const slot = slotOf[member]
      slots = Arr.filter([slot], (given) => given !== -1)
    }
    // Its transitions, its own copies, so the Playhead driving them reaches its keys alone.
    const copies = new Map<Batch.Transition, Batch.Transition>()
    const copyOf = (bag: Batch.Transition): Batch.Transition => {
      const known = copies.get(bag)
      if (Predicate.isNotUndefined(known)) return known
      const made = { ...bag } as Batch.Transition
      copies.set(bag, made)
      return made
    }
    let transition: (slot: number, k: number) => Batch.Transition = () => copyOf(INSTANT)
    let delay: Batch.RetargetOptions["delay"] = undefined
    if (!call.skipAnimations) {
      const planned = plannedOf(env, keys, UndefinedOr.map(call.transition, unstaggered), call.reducedMotion)
      transition = (slot: number, k: number): Batch.Transition => {
        const plan = planned[k]
        if (Predicate.isNotUndefined(plan.own)) return copyOf(plan.own)
        return copyOf(delayedBy(defaultFor(k, callTarget(slot, k)), plan.delay))
      }
      delay = staggerOf(call.transition)
    }
    const animation = Batch.animate(batch, slots, callTarget, {
      head: call.head,
      transition,
      onLanded: call.settled,
      ...Bool.match(Arr.some(froms, Predicate.isNotUndefined), { onTrue: () => ({ from: callFrom }), onFalse: () => ({}) }),
      ...Bool.match(Predicate.isUndefined(delay), { onTrue: () => ({}), onFalse: () => ({ delay: delay as NonNullable<Batch.RetargetOptions["delay"]> }) }),
    })
    let first = true
    return {
      run: () => {
        if (disposed) return
        Batch.play(animation)
        let setOff = 0
        if (first) setOff = slots.length
        first = false
        wake(setOff)
      },
      stop: () => {
        Batch.stop(animation)
        wake(0)
      },
      cancel: () => {
        Batch.cancel(animation)
        wake(0)
      },
      duration: () => Batch.durationOf(animation),
    }
  }

  return {
    track,
    targetsOf,
    apply: (targets) => {
      current = targets
      if (disposed) return
      change(entered)
    },
    refOf: (i) => {
      if (!isMember(i, count)) return noMember(i, count)
      return refs[i]
    },
    styleOf: <Style>(style: Style): Style => {
      if (Predicate.isString(style)) {
        return fail(`give a member's own \`style\` as an object: Solid writes a string over what the Batch draws`)
      }
      if (!Predicate.isObject(style)) return style
      return Rec.filter(style as Readonly<Record<string, unknown>>, (_, name) => !drawn.has(name)) as Style
    },
    dispose: () => {
      disposed = true
      Iter.forEach(fibers, (fiber) => fiber.interruptUnsafe())
      fibers.clear()
    },
  }
}
