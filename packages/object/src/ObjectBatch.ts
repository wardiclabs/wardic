/**
 * Many objects animated on the same keys as one run (a **Batch**): hundreds of sprites, a chart's points,
 * a grid of meshes that move together. `wardic.batch(objects)` makes one; `animate(batch, target)` moves
 * every member, each key's value a number, two stops (its first and its target), or a function of a
 * member's index and the count; `animate(batch.at(i), target)` moves member `i`. A new target turns each
 * member toward it at the speed it has, for a fraction of what an animation per object costs.
 *
 * - **Its keys** are fixed by its first `animate` (or `keys` when it's made). Each member starts from
 *   its own values for them, numbers each.
 * - **Its members** are reached through it: an object of a Batch given to `animate` itself is an error.
 *
 * @example
 * const swarm = wardic.batch(sprites)
 * wardic.animate(swarm, { x: (i) => i * 12, y: [0, 40] }, { type: "spring", delay: stagger(0.01) })
 * wardic.animate(swarm.at(3), { y: 0 })
 */
// `@wardic/object/ObjectBatch` (#882; ADR-0069 decisions 10–18, ADR-0073, *Amendment (#882)*, PR 3): core's
// Batch with a property writer, its calls core's `BatchCalls`, the DOM's. Its keys at its first call or
// `keys` (the DOM's keyed `createBatch`'s rule, #665's PR 3a); a member object animated itself is an error
// until a driver's hold (ADR-0069 decision 17) comes with `@wardic/three`.
import * as Batch from "@wardic/core/Batch"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as BatchCalls from "@wardic/core/unstable/BatchCalls"
import type * as Imperative from "@wardic/core/unstable/Imperative"
import type * as Spine from "@wardic/core/unstable/Spine"
import * as Arr from "effect/Array"
import type * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"

/** A stop of a Batch's `animate`: a number for every member, or a function of a member's index and the count. */
export type Stop = number | ((i: number, n: number) => number)

/** A key of `T` a Batch animates: one whose value is a number. */
export type NumberKey<T> = { readonly [K in keyof T]-?: T[K] extends number ? K : never }[keyof T] & string

/** A Batch's targets for an `animate` call: each key a stop, two (its first and its target), or a function giving them. */
export type Target<T> = {
  readonly [K in NumberKey<T>]?: Stop | readonly [Stop, Stop] | ((i: number, n: number) => number | readonly [number, number])
}

/** A Batch's key in a sequence's Segment of it: a number, `null` for where it is, stops of them, or a function giving them. */
export type SegmentValue = number | null | ReadonlyArray<number | null> | ((i: number, n: number) => number | null | ReadonlyArray<number | null>)

/** A member's handle: `animate` and a sequence's Segment move member `i` alone. */
export interface Member<T extends object> {
  readonly i: number
  readonly batch: ObjectBatch<T>
}

/** A Batch of objects `T`. */
export interface ObjectBatch<T extends object> {
  /** Its members, in order. */
  readonly members: ReadonlyArray<T>
  /** Member `i`'s handle, for `animate` and a sequence's Segment. */
  readonly at: (i: number) => Member<T>
  /** Member `i`'s value for `key` now: as drawn, once the Batch has moved; its own before. */
  readonly get: (i: number, key: NumberKey<T>) => number
  /** Member `i`'s velocity for `key` now, per second: 0 before the Batch has moved. */
  readonly velocity: (i: number, key: NumberKey<T>) => number
}

/** `wardic.batch`'s options. */
export interface Options<T> {
  /** Its keys, fixed now: else its first `animate`'s, or its first Segment's. */
  readonly keys?: ReadonlyArray<NumberKey<T>> | undefined
}

/** What a runtime gives its Batches: its fork, and its Environment's Positional keys and Default transitions. */
export interface Context {
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, FrameLoop.FrameLoop>) => Fiber.Fiber<A, E>
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
}

/** The property writer for a Batch's keys: each member's values onto its properties, by name. */
// Per frame: a plain loop over the keys, nothing allocated.
export const writer: Batch.Writer<object> = {
  writes: () => true,
  forKeys: (keys) => (subject, positions, base) => {
    const object = subject as Record<string, number>
    for (let k = 0; k < keys.length; k++) object[keys[k]] = positions[base + k]
  },
}

/** Each Batch's and member handle's entry, so `animate` knows them. */
// Module state (#460, Q7): held weakly by the handle, so it goes with it.
const ENTRIES = new WeakMap<object, Imperative.BatchEntry>()

/** Each member object's place in its Batch, so `animate` of it itself is an error naming its handle. */
// Module state (#460, Q7): held weakly by the object.
const MEMBERS = new WeakMap<object, number>()

/** The Batch or member handle `given` is, for `animate`: `undefined` for anything else. */
export const entryOf = (given: unknown): Imperative.BatchEntry | undefined => {
  if (!Predicate.isObject(given)) return undefined
  return ENTRIES.get(given)
}

/** `object`'s member number in a Batch, or `undefined` when it's no Batch's. */
export const memberOf = (object: object): number | undefined => MEMBERS.get(object)

/** A Batch call's error, naming what it got. */
const fail = (message: string): never => {
  throw new Error(`wardic.batch: ${message}`)
}

/** `values`' keys that it gives: a target's or a Segment's. */
const givenKeys = (values: Readonly<Record<string, unknown>>): ReadonlyArray<string> => Arr.filter(Rec.keys(values), (key) => Predicate.isNotUndefined(values[key]))

/** A Batch of `objects` for a runtime, its keys `options.keys`, else its first call's. */
export const make = <T extends object>(context: Context, objects: ReadonlyArray<T>, options: Options<T> = {}): ObjectBatch<T> => {
  let keys: ReadonlyArray<string> = []
  let keyIndex: ReadonlyMap<string, number> = new Map()
  let batch: Batch.Batch<object> | undefined
  // Each member's slot in the core Batch, by its number.
  let slots: ReadonlyArray<number> = []
  const memberAt: Array<number> = []
  const count = (): number => objects.length
  const all: ReadonlyArray<number> = Arr.makeBy(objects.length, (i) => i)

  const planning = (): BatchCalls.Planning => ({
    keys,
    positionalKeys: context.positionalKeys,
    defaultFor: (k, target) => context.defaultTransition.transitionFor(keys[k] as string, target) as Batch.Transition,
    fail,
  })
  const bySlot: BatchCalls.Members = { indexOf: (slot) => memberAt[slot] as number, count, nameOf: (slot) => `member ${memberAt[slot]}` }
  const byMember: BatchCalls.Members = { indexOf: (i) => i, count, nameOf: (i) => `member ${i}` }

  /** Member `i`'s start on the Batch's keys: its own values, numbers each, else an error naming it. */
  const startOf = (object: T, i: number): Readonly<Record<string, number>> =>
    Rec.fromEntries(
      Arr.map(keys, (key) => {
        const value = (object as Readonly<Record<string, unknown>>)[key]
        if (!Predicate.isNumber(value)) fail(`member ${i}'s "${key}" is ${JSON.stringify(value)}: a Batch's keys are numbers on each of its objects`)
        return [key, value as number] as const
      }),
    )

  /** The core Batch, made on `given` keys at its first need, each member entered at its own values. */
  const made = (given: ReadonlyArray<string>): Batch.Batch<object> => {
    if (Predicate.isNotUndefined(batch)) return batch
    keys = given
    keyIndex = new Map(Arr.map(keys, (key, k) => [key, k] as const))
    const transition = Rec.fromEntries(Arr.map(keys, (key) => [key, context.defaultTransition.transitionFor(key, 1) as Batch.Transition] as const))
    const created = Batch.make({ keys, writer, transition })
    slots = Arr.map(objects, (object, i) => {
      const slot = Batch.enter(created, object as object, startOf(object, i))
      memberAt[slot] = i
      return slot
    })
    batch = created
    return created
  }

  /** `given`'s keys, each one of the Batch's, else an error naming it and the way to give more. */
  const checked = (given: ReadonlyArray<string>): void =>
    Arr.forEach(given, (key) => {
      if (keyIndex.has(key)) return
      fail(`"${key}" isn't one of its keys (${keys.join(", ")}): a Batch's keys are its first animate's, so give them all as \`keys\` when it's made, wardic.batch(objects, { keys })`)
    })

  /** Its run on the Frame loop, while a member moves. */
  const wake = (running: Batch.Batch<object>): void => {
    if (Batch.isMoving(running)) void context.runFork(Batch.run(running))
  }

  /** A driven change's controls, as an `animate` call's track. */
  const controlsOf = (running: Batch.Batch<object>, animation: Batch.Animation): Spine.ImperativeTrack => ({
    run: () => {
      Batch.play(animation)
      wake(running)
    },
    stop: () => {
      Batch.stop(animation)
      wake(running)
    },
    cancel: () => {
      Batch.cancel(animation)
      wake(running)
    },
    duration: () => Batch.durationOf(animation),
  })

  /** The slots `named` members hold, every member's when it names none. */
  const slotsOf = (named: ReadonlyArray<number> | undefined): ReadonlyArray<number> =>
    Arr.map(UndefinedOr.match(named, { onUndefined: () => all, onDefined: (given) => given }), (i) => slots[i] as number)

  const binding: Imperative.BatchCalls = {
    track: (call) => {
      const given = call.target as Readonly<Record<string, unknown>>
      const running = made(givenKeys(given))
      checked(givenKeys(given))
      const moving = slotsOf(call.members)
      const { toOf, fromOf } = BatchCalls.callTargets(planning(), keyIndex, bySlot, moving, given)
      return controlsOf(running, Batch.animate(running, moving, toOf, BatchCalls.animateOptions(planning(), call, toOf, fromOf)))
    },
    namedOf: (entry) => UndefinedOr.map(entry.member, (i) => [i]),
    segmentOf: (named, target) => {
      made(givenKeys(target))
      const moving = UndefinedOr.match(named, { onUndefined: () => all, onDefined: (given) => given })
      return { subjects: Arr.map(moving, (i) => memberEntries[i] as Imperative.BatchMember), values: BatchCalls.segmentValues(planning(), (key) => keyIndex.has(key), byMember, moving, target) }
    },
    sequenceTrack: (call) => {
      const running = made(keys)
      const moving: Array<number> = []
      const animations: Array<(typeof call.animations)[number] | undefined> = []
      Arr.forEach(call.members, (i, n) => {
        const slot = slots[i] as number
        moving.push(slot)
        animations[slot] = call.animations[n]
      })
      const keyframesOf = BatchCalls.keyframesFor(planning(), call, (slot) => UndefinedOr.getOrThrow(animations[slot]))
      return controlsOf(running, Batch.keyframes(running, moving, keyframesOf, { head: call.head, onLanded: call.settled }))
    },
  }

  const memberEntries: ReadonlyArray<Imperative.BatchMember> = Arr.map(objects, (_, i) => ({ binding, member: i }))
  const handles: Array<Member<T> | undefined> = []
  const handle: ObjectBatch<T> = {
    members: objects,
    at: (i) => {
      const known = handles[i]
      if (Predicate.isNotUndefined(known)) return known
      if (Predicate.isUndefined(objects[i])) fail(`it has ${objects.length} members: there's no member ${i}`)
      const made: Member<T> = { i, batch: handle }
      ENTRIES.set(made, memberEntries[i] as Imperative.BatchMember)
      handles[i] = made
      return made
    },
    get: (i, key) =>
      UndefinedOr.match(batch, {
        onUndefined: () => (objects[i] as unknown as Readonly<Record<string, number>>)[key] as number,
        onDefined: (running) => Batch.get(running, slots[i] as number, key),
      }),
    velocity: (i, key) =>
      UndefinedOr.match(batch, {
        onUndefined: () => 0,
        onDefined: (running) => Batch.velocity(running, slots[i] as number, key),
      }),
  }
  ENTRIES.set(handle, { binding, member: undefined })
  Arr.forEach(objects, (object, i) => {
    if (Predicate.isNotUndefined(MEMBERS.get(object))) fail(`member ${i} is already a member of a Batch: an object is one Batch's`)
    MEMBERS.set(object, i)
  })
  if (Predicate.isNotUndefined(options.keys)) made(options.keys)
  return handle
}
