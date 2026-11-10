/**
 * A Batch: many Subjects animated on the same keys as one run on the Frame loop, for a list, a grid or
 * a chart's points that move together. Each member's values, velocities and targets are kept by
 * index, so a new target turns every member toward it at the speed it already has, and a change
 * costs an array write per member, not an animation each. An Environment's writer draws each member
 * as it moves.
 *
 * @example
 * import * as Batch from "@wardic/core/Batch"
 *
 * const grid = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring", visualDuration: 0.4 } })
 * const slots = [first, second, third].map((tile) => Batch.enter(grid, tile, { x: 0, y: 0 }))
 * Batch.retarget(grid, slots, (slot, k) => cellOf(slot)[k])
 */
// #665, ADR-0069 decisions 10–18 and *Amendment (#665)*. Tier 2 (ADR-0008): for binding and Environment
// authors; an app reaches a Batch through its binding's `createBatch`. State by index in typed arrays,
// a member's keys at `slot * stride + k` (#663's shape); stepped by `Spring.matrixFor`'s exact step
// (#370), the probe's loop (`.tmp/564-canvas/perf/group.ts` on `probe/564-canvas`).
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Inspectable from "effect/Inspectable"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type { Invariant } from "effect/Types"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Frame from "./Frame.ts"
import type * as FrameLoop from "./FrameLoop.ts"
import * as Machine from "./Machine.ts"
import type * as Playback from "./Playback.ts"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"
import { dual } from "./internal/dual.ts"
import { checked, fn, literals, nonNegative, positive, union } from "./internal/options.ts"
import type { ResolvedTween } from "./internal/stepper.ts"

const TypeId = "~@wardic/core/Batch"

/**
 * How an Environment draws a Batch's members: whether it can draw a key, and its write for one Batch's
 * keys, built once when the Batch is made. The write gets a member's Subject and its values, the
 * Batch's keys in order from `base`: plain numbers, read as it's called.
 */
// ADR-0069, *Amendment (#665)*: positional, so a frame builds no record per member.
export interface Writer<S> {
  /** Whether it can draw `key`. */
  readonly writes: (key: string) => boolean
  /** Its write for a Batch with these keys, in this order. */
  readonly forKeys: (keys: ReadonlyArray<string>) => (subject: S, positions: Float64Array, base: number) => void
  /** Called once a frame, after every member's write: for a writer that hands what it wrote on in one go. */
  readonly flush?: () => void
}

/** A transition a Batch runs a key with: a spring, or a tween. */
export type Transition =
  | ({ readonly type: "spring" } & Omit<Machine.SpringOptions, "from" | "velocity">)
  | ({ readonly type: "tween" } & Machine.TweenOptions)

/** One transition for every key, or one per key by its name, with `default` for the keys it doesn't name. */
export type Transitions = Transition | Readonly<Record<string, Transition>>

/** `retarget`'s options. */
export interface RetargetOptions {
  /**
   * How this change's keys move: a key it doesn't give, nor its `default`, moves by the Batch's own. Or
   * a function of a member's slot and its key's index, for members whose keys move differently. Give the
   * same object for members that move alike: they then step together.
   */
  // #665: the DOM's Default transition, a scale toward 0 on a spring of its own.
  readonly transition?: Transitions | ((slot: number, k: number) => Transition)
  /**
   * Seconds each member waits before it moves, after its transition's own delay: one for all, or by
   * its rank among the members this change moves, of `n`, as `Stagger.make`'s delays are.
   */
  // ADR-0069, *Amendment (#665)*: the movers, as Motion's `animate(elements)` counts what it's given.
  readonly delay?: number | ((rank: number, n: number) => number)
}

/** `make`'s options. */
export interface Options<S> {
  /** The keys its members animate, fixed when it's made. */
  readonly keys: ReadonlyArray<string>
  /** How its members are drawn. */
  readonly writer: Writer<S>
  /** How its keys move, unless a change gives its own: every key needs one, its own or `default`. */
  readonly transition: Transitions
  /** How many members it holds before it grows. Default 16. */
  readonly capacity?: number
  /** Called once a frame, after every member's write: Motion's `onUpdate`, for the whole Batch. */
  // ADR-0069 decision 16: never per member.
  readonly onFrame?: () => void
}

/** A Batch of Subjects `S`: built by `make`, never as a literal. */
export interface Batch<S> extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: { readonly _S: Invariant<S> }
  /** The keys its members animate, in the order its writer reads them. */
  readonly keys: ReadonlyArray<string>
}

// --- The table: the transitions a Batch's keys run -----------------------------
//
// ADR-0069, *Amendment (#665)*. Each member's key records its rule: the index of the transition it runs.
// An entry is held by the keys that run it, and freed for reuse once none does, so the table holds only
// what its keys run now, whatever bag each change brings. The Batch's own transitions are pinned.

/** An entry's kind: a spring, a tween, a spring that ends at its `duration`, or a freed entry. */
// #359: a spring set by duration lands there.
const SPRING = 0
const TWEEN = 1
const TIMED = 2
const FREE = 3

/** Numbers in a spring entry's matrix for this frame: `dd`, `dv`, `vd`, `vv`. */
const MATRIX = 4

/** How many entries a table holds before it grows. */
const TABLE_START = 8

/** The most entries a table holds at once: a rule is a `Uint16Array`'s. */
const TABLE_MAX = 65536

/** A transition in a Batch's table, resolved once: a spring's physics, or a tween's curve. */
interface Entry {
  readonly kind: typeof SPRING | typeof TWEEN | typeof TIMED
  readonly delay: number
  readonly spring: Spring.Resolved
  readonly tween: ResolvedTween
}

// --- A slot's flags -------------------------------------------------------------

/** A member holds it, from its `enter` to its `leave`. */
const LIVE = 1
/** It moves in the plain list: every key on the Batch's own spring. */
const IN_PLAIN = 2
/** It moves in the ruled list: each key by its rule. */
const IN_RULED = 4
/** A change counted it among its movers: a slot given twice moves once. */
const COUNTED = 8

/** A Batch's state, which only this module's operations write. */
interface State<S> {
  readonly keys: ReadonlyArray<string>
  readonly stride: number
  /** Each key's index, by its name. */
  readonly indexOfKey: Readonly<Record<string, number>>
  capacity: number
  /** How many slots have ever been entered: every slot below is a member's. */
  used: number
  readonly subjects: Array<S | undefined>
  positions: Float64Array
  velocities: Float64Array
  targets: Float64Array
  elapsed: Float64Array
  delays: Float64Array
  restDeltas: Float64Array
  restSpeeds: Float64Array
  /** Where each member's key started its change: a tween's start, a driven change's to seek from. */
  origins: Float64Array
  /** How fast each member's key was moving when its change started: a driven change's to seek from. */
  originVelocities: Float64Array
  /** Each member's key's rule: its entry in the table. */
  rules: Uint16Array
  /** A change's new targets, `NaN` for a key it keeps: its first pass's, read by its second. */
  pending: Float64Array
  /** A change's members that move, in order: its first pass's. */
  movers: Int32Array
  /**
   * Per slot, `LIVE` while a member holds it, `IN_PLAIN` or `IN_RULED` while it moves. A member a change
   * gives another transition moves to the ruled list and stays until it rests; the plain list drops it
   * at its next step. One byte, so each step reads one per member.
   */
  flags: Uint8Array
  /** The slots a `leave` freed, the next `enter`'s. */
  readonly free: Array<number>
  /** The members moving with every key on the Batch's own spring, `plainCount` of them: one matrix for all. */
  plainList: Int32Array
  plainCount: number
  /** The members moving with a key on another transition, `ruledCount` of them: each key by its rule. */
  // ADR-0069, *Amendment (#665)*: read per key for every member, the rules cost a step 13–16% (Bun, Node;
  // 10,000 members), so the members on the Batch's own spring step as if there were none.
  ruledList: Int32Array
  ruledCount: number
  /** The table's entries, by rule. */
  readonly entries: Array<Entry>
  /** Each entry's kind by its rule, read per key in place of the entry. */
  kinds: Uint8Array
  /** Each spring entry's matrix for this frame's `dt`, `MATRIX` numbers an entry: worked out once a frame. */
  matrices: Float64Array
  /** How many keys run each entry; a pinned entry isn't counted. */
  uses: Uint32Array
  /** Each entry's Playhead, while an animation it drives plays: its keys step at its speed, and move its time. */
  readonly heads: Array<Playback.Playhead | undefined>
  /** Each entry's step this frame: the frame's `dt`, or a driven entry's at its Playhead's speed. */
  dts: Float64Array
  /** The animations playing, each checked for its landing once a frame. */
  readonly animations: Set<AnimationState<S>>
  /** The bag each entry was given as. */
  readonly bags: Array<Transition | undefined>
  /** Each entry's rule, by the bag it was given as. */
  readonly ruleByBag: Map<Transition, number>
  /** The freed entries, the next transition's. */
  readonly freeRules: Array<number>
  /** How many entries are the Batch's own, never freed: the first. */
  pinned: number
  /** Each key's own rule: what it runs when a change gives it none. */
  ownRules: ReadonlyArray<number>
  readonly write: (subject: S, positions: Float64Array, base: number) => void
  readonly flush: () => void
  readonly onFrame: () => void
  /** The run stepping it now, by its number, or 0 for none. */
  running: number
  /** How many runs it has had: the next one's number. */
  runs: number
}

const Proto = {
  [TypeId]: { _S: identity },
  ...Inspectable.BaseProto,
  toJSON(this: State<unknown>) {
    return {
      _id: "Batch",
      keys: this.keys,
      members: this.used - this.free.length,
      moving: this.plainCount + this.ruledCount,
      transitions: this.entries.length - this.freeRules.length,
    }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/** Whether `u` is a Batch. */
export const isBatch = (u: unknown): u is Batch<unknown> => Predicate.hasProperty(u, TypeId)

const stateOf = <S>(batch: Batch<S>): State<S> => batch as unknown as State<S>

const noop = (): void => {}

/** No spring: a tween's entry's. */
const NO_SPRING: Spring.Resolved = Spring.resolve({})

/** No tween: a spring's entry's. */
const NO_TWEEN: ResolvedTween = Machine.resolveTween({})

/** The transitions a Batch runs: springs and tweens alone (ADR-0069, decision 11), no keyframes, inertia or decay. */
const RunType = /*#__PURE__*/ literals(["spring", "tween"])

/** A change's delay: seconds, or a function of a mover's rank and how many move. */
const Delay = /*#__PURE__*/ union([nonNegative, fn<(rank: number, n: number) => number>("a function of a mover's rank and how many move")])

/** A spring's entry: one that ends at its duration is timed (#359). */
const springEntry = (transition: Transition): Entry => {
  const spring = Spring.resolve(transition as Machine.SpringOptions)
  if (Spring.endsOnTime(spring)) return { kind: TIMED, delay: spring.delay, spring, tween: NO_TWEEN }
  return { kind: SPRING, delay: spring.delay, spring, tween: NO_TWEEN }
}

/** A tween's entry. */
const tweenEntry = (transition: Transition): Entry => {
  const tween = Machine.resolveTween(transition as Machine.TweenOptions)
  return { kind: TWEEN, delay: tween.delay, spring: NO_SPRING, tween }
}

/** A checked transition's entry, by its `type`. */
const entryByType: (transition: Transition) => Entry = /*#__PURE__*/ Match.type<Transition>().pipe(
  Match.discriminator("type")("tween", tweenEntry),
  Match.orElse(springEntry),
)

/** `transition`, resolved for the table: its `type` checked, and its bag (`Spring.resolve`, `resolveTween`). */
const entryFor = (transition: Transition): Entry => {
  checked(RunType, transition.type, "type")
  return entryByType(transition)
}

/** Whether `transitions` is one transition, not one per key. */
const isTransition = (transitions: Transitions): transitions is Transition => Predicate.hasProperty(transitions, "type")

/** `transition`'s rule in `state`'s table: its entry, or a new one at its first use, in a freed entry if there is one. */
const ruleFor = <S>(state: State<S>, transition: Transition): number => {
  const known = state.ruleByBag.get(transition)
  if (Predicate.isNotUndefined(known)) return known
  const entry = entryFor(transition)
  const freed = state.freeRules.pop()
  let rule = state.entries.length
  if (Predicate.isNotUndefined(freed)) rule = freed
  if (rule === TABLE_MAX) {
    throw new Machine.OptionError({ message: `Expected at most ${TABLE_MAX} transitions running at once\n  at ["transition"]` })
  }
  if (rule === state.kinds.length) {
    state.kinds = grown(state.kinds, rule * 2)
    state.matrices = grown(state.matrices, rule * 2 * MATRIX)
    state.uses = grown(state.uses, rule * 2)
    state.dts = grown(state.dts, rule * 2)
  }
  state.entries[rule] = entry
  state.heads[rule] = undefined
  state.bags[rule] = transition
  state.kinds[rule] = entry.kind
  state.uses[rule] = 0
  state.ruleByBag.set(transition, rule)
  return rule
}

/** One more key runs `rule`. */
const hold = <S>(state: State<S>, rule: number): void => {
  if (rule < state.pinned) return
  state.uses[rule] = state.uses[rule] + 1
}

/** One key fewer runs `rule`: once none does, its entry is freed. */
const release = <S>(state: State<S>, rule: number): void => {
  if (rule < state.pinned) return
  if (state.kinds[rule] === FREE) return
  if (state.uses[rule] > 0) state.uses[rule] = state.uses[rule] - 1
  if (state.uses[rule] > 0) return
  const bag = state.bags[rule]
  // Forgotten at a rest already (`forgetTransitions`).
  if (Predicate.isUndefined(bag)) return
  state.kinds[rule] = FREE
  state.ruleByBag.delete(bag)
  state.bags[rule] = undefined
  state.freeRules.push(rule)
}

/** `transitions`' rule for each of `state`'s keys, by index; a key it doesn't name, nor its `default`, takes `fallback`'s. */
const rulesOf = <S>(state: State<S>, transitions: Transitions, fallback: (k: number) => number): ReadonlyArray<number> => {
  if (isTransition(transitions)) {
    const rule = ruleFor(state, transitions)
    return Arr.map(state.keys, () => rule)
  }
  return Arr.map(state.keys, (key, k) => {
    const given = transitions[key]
    if (Predicate.isNotUndefined(given)) return ruleFor(state, given)
    const otherwise = transitions["default"]
    if (Predicate.isNotUndefined(otherwise)) return ruleFor(state, otherwise)
    return fallback(k)
  })
}

/** A key `make`'s transitions leave without one: every key needs its own or the `default`. */
const unnamedKey = <S>(state: State<S>) => (k: number): number => {
  throw new Machine.OptionError({ message: `Expected a transition for each key, or a "default"\n  at ["transition"]["${state.keys[k]}"]` })
}

/**
 * A Batch of no members yet, on `options.keys`, drawn by `options.writer`.
 *
 * @example
 * const grid = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
 */
export const make = <S>(options: Options<S>): Batch<S> => {
  Arr.forEach(options.keys, (key, k) => {
    if (options.writer.writes(key)) return
    throw new Machine.OptionError({ message: `Expected a key its writer draws, got ${JSON.stringify(key)}\n  at ["keys"][${k}]` })
  })
  const capacity = Math.ceil(checked(positive, UndefinedOr.match(options.capacity, { onUndefined: () => 16, onDefined: identity }), "capacity"))
  const stride = options.keys.length
  const size = capacity * stride
  const state: State<S> = {
    keys: options.keys,
    stride,
    indexOfKey: Arr.reduce(options.keys, {}, (indices: Record<string, number>, key, k) => {
      indices[key] = k
      return indices
    }),
    capacity,
    used: 0,
    subjects: [],
    positions: new Float64Array(size),
    velocities: new Float64Array(size),
    targets: new Float64Array(size),
    elapsed: new Float64Array(size),
    delays: new Float64Array(size),
    restDeltas: new Float64Array(size),
    restSpeeds: new Float64Array(size),
    origins: new Float64Array(size),
    originVelocities: new Float64Array(size),
    rules: new Uint16Array(size),
    pending: new Float64Array(size),
    movers: new Int32Array(capacity),
    flags: new Uint8Array(capacity),
    free: [],
    plainList: new Int32Array(capacity),
    plainCount: 0,
    ruledList: new Int32Array(capacity),
    ruledCount: 0,
    entries: [],
    kinds: new Uint8Array(TABLE_START),
    matrices: new Float64Array(TABLE_START * MATRIX),
    uses: new Uint32Array(TABLE_START),
    heads: [],
    dts: new Float64Array(TABLE_START),
    animations: new Set(),
    bags: [],
    ruleByBag: new Map(),
    freeRules: [],
    pinned: 0,
    ownRules: [],
    write: options.writer.forKeys(options.keys),
    flush: UndefinedOr.match(options.writer.flush, { onUndefined: () => noop, onDefined: identity }),
    onFrame: UndefinedOr.match(options.onFrame, { onUndefined: () => noop, onDefined: identity }),
    running: 0,
    runs: 0,
  }
  // The Batch's own transitions, pinned: the first entries, rule 0 the first key's.
  state.ownRules = rulesOf(state, options.transition, unnamedKey(state))
  state.pinned = state.entries.length
  return Object.assign(Object.create(Proto), state)
}

/** A change's rule for each key, when its transitions are one or one per key; the Batch's own else. */
// Once a change.
const changeRulesOf = <S>(state: State<S>, transitions: RetargetOptions["transition"]): ReadonlyArray<number> => {
  if (Predicate.isUndefined(transitions)) return state.ownRules
  if (Predicate.isFunction(transitions)) return state.ownRules
  return rulesOf(state, transitions, (k) => state.ownRules[k])
}

/**
 * A change's rule for a member's key, when its transition is a function of them: the bag it gives,
 * the last one's rule again when it's the same, while the table still holds it.
 */
// Most members give the bag the last one gave: one comparison, where `ruleFor` is a Map lookup per
// member's key (#665's Chromium profile, 1,000 members).
const ruleAtOf = <S>(state: State<S>, given: RetargetOptions["transition"]): ((slot: number, k: number) => number) | undefined => {
  if (!Predicate.isFunction(given)) return undefined
  let lastBag: Transition | undefined = undefined
  let lastRule = 0
  return (slot, k) => {
    const bag = given(slot, k)
    if (bag === lastBag && state.bags[lastRule] === bag) return lastRule
    lastBag = bag
    lastRule = ruleFor(state, bag)
    return lastRule
  }
}

/** No delay: a change's that gives none. */
const NO_DELAY = (): number => 0

/** A change's delay as a function of a mover's rank and how many move: once a change. */
const delayOfChange: (delay: RetargetOptions["delay"]) => (rank: number, n: number) => number = /*#__PURE__*/ Match.type<
  RetargetOptions["delay"]
>().pipe(
  Match.when(Predicate.isUndefined, () => NO_DELAY),
  Match.when(Predicate.isNumber, (seconds) => (): number => seconds),
  Match.orElse((delayOf: (rank: number, n: number) => number) => delayOf),
)

/**
 * A new member, `subject`, starting from `start`'s values (a key it doesn't give starts at 0): its
 * slot, which every other operation takes.
 *
 * @example
 * const slot = Batch.enter(grid, tile, { x: 0, y: 0 })
 */
export const enter: {
  <S>(subject: S, start: Readonly<Record<string, number>>): (self: Batch<S>) => number
  <S>(self: Batch<S>, subject: S, start: Readonly<Record<string, number>>): number
} = dual(3, <S>(self: Batch<S>, subject: S, start: Readonly<Record<string, number>>): number => {
  const state = stateOf(self)
  const slot = slotFor(state)
  state.subjects[slot] = subject
  state.flags[slot] = state.flags[slot] | LIVE
  const base = slot * state.stride
  Arr.forEach(state.keys, (key, k) => {
    const given = start[key]
    let value = 0
    if (Predicate.isNotUndefined(given)) value = given
    const at = base + k
    state.positions[at] = value
    state.targets[at] = value
    state.velocities[at] = 0
    // A reused slot keeps nothing of the member before: at rest on its start, on its own transition.
    state.elapsed[at] = 0
    state.delays[at] = 0
    release(state, state.rules[at])
    state.rules[at] = state.ownRules[k]
  })
  return slot
})

/**
 * The member at `slot` leaves: it isn't written again, and its slot goes to the next to enter.
 *
 * @example
 * Batch.leave(grid, slot)
 */
// Its slot stays in its moving list until the next step drops it: no search per leave.
export const leave: {
  (slot: number): <S>(self: Batch<S>) => void
  <S>(self: Batch<S>, slot: number): void
} = dual(2, <S>(self: Batch<S>, slot: number): void => {
  const state = stateOf(self)
  if ((state.flags[slot] & LIVE) === 0) return
  state.flags[slot] = state.flags[slot] & ~LIVE
  state.subjects[slot] = undefined
  state.free.push(slot)
})

/**
 * The member at `slot` is drawn on `subject` from now on: its values, speed, targets and delays carry
 * on as they were. For an element its framework made again for the same member.
 *
 * @example
 * Batch.replace(grid, slot, element)
 */
export const replace: {
  <S>(slot: number, subject: S): (self: Batch<S>) => void
  <S>(self: Batch<S>, slot: number, subject: S): void
} = dual(3, <S>(self: Batch<S>, slot: number, subject: S): void => {
  const state = stateOf(self)
  if ((state.flags[slot] & LIVE) === 0) return
  state.subjects[slot] = subject
})

/** A slot for a new member: one a `leave` freed, else the next, the arrays doubled when they're full. */
const slotFor = <S>(state: State<S>): number => {
  const freed = state.free.pop()
  if (Predicate.isNotUndefined(freed)) return freed
  const slot = state.used
  if (slot === state.capacity) grow(state, state.capacity * 2)
  state.used = slot + 1
  return slot
}

/** `from` copied into a new array of `size`: a grown Batch's. */
const grown = <A extends Float64Array | Int32Array | Uint8Array | Uint16Array | Uint32Array>(from: A, size: number): A => {
  const to = new (from.constructor as new (size: number) => A)(size)
  to.set(from)
  return to
}

/** `state`'s arrays grown to hold `capacity` members, every member's state copied across. */
const grow = <S>(state: State<S>, capacity: number): void => {
  const size = capacity * state.stride
  state.capacity = capacity
  state.positions = grown(state.positions, size)
  state.velocities = grown(state.velocities, size)
  state.targets = grown(state.targets, size)
  state.elapsed = grown(state.elapsed, size)
  state.delays = grown(state.delays, size)
  state.restDeltas = grown(state.restDeltas, size)
  state.restSpeeds = grown(state.restSpeeds, size)
  state.origins = grown(state.origins, size)
  state.originVelocities = grown(state.originVelocities, size)
  state.rules = grown(state.rules, size)
  state.pending = grown(state.pending, size)
  state.movers = grown(state.movers, capacity)
  state.flags = grown(state.flags, capacity)
  state.plainList = grown(state.plainList, capacity)
  state.ruledList = grown(state.ruledList, capacity)
}

/**
 * One change: each of `slots`' members turned toward `targetOf(slot, k)` for its `k`th key (`NaN`
 * keeps that key's target). A member whose targets are unchanged gets nothing. It returns how many
 * members it sets off from rest.
 *
 * @example
 * const grid = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
 * Batch.retarget(grid, slots, (slot, k) => cellOf(slot)[k], { delay: Stagger.make(0.02) })
 */
export const retarget: {
  (slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options?: RetargetOptions): <S>(self: Batch<S>) => number
  <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options?: RetargetOptions): number
} = dual(isBatch, <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options?: RetargetOptions): number => {
  const state = stateOf(self)
  const { stride, pending, movers, targets, flags } = state
  // Per member per key at a change, a Batch's own loops over its typed arrays, as its step's (ADR-0025,
  // *Amendment (#665)*): `Arr.forEach` over the slots cost a closure call each. The first pass keeps
  // each new target and finds the members that move, so the second can count them for their delays.
  let n = 0
  const given = slots.length
  for (let g = 0; g < given; g++) {
    const slot = slots[g]
    const flag = flags[slot]
    // A member that left takes no change; one given twice moves once.
    if ((flag & LIVE) === 0) continue
    if ((flag & COUNTED) !== 0) continue
    const base = slot * stride
    let moves = false
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const target = targetOf(slot, k)
      pending[at] = target
      if (!Number.isNaN(target) && target !== targets[at]) moves = true
    }
    if (!moves) continue
    flags[slot] = flag | COUNTED
    movers[n] = slot
    n++
  }
  // A change that moves nothing touches no transition.
  if (n === 0) return 0
  const transitions = UndefinedOr.map(options, (bag) => bag.transition)
  const rules = changeRulesOf(state, transitions)
  const ruleAt = ruleAtOf(state, transitions)
  const delay = UndefinedOr.map(options, (bag) => bag.delay)
  if (Predicate.isNotUndefined(delay)) checked(Delay, delay, "delay")
  const delayOf = delayOfChange(delay)
  // This change's transitions are held while it runs, so a key it moves off one doesn't free one it
  // gives another key; one it gives no key is freed after.
  const held = Arr.dedupe(rules)
  Arr.forEach(held, (rule) => hold(state, rule))
  let setOff = 0
  for (let rank = 0; rank < n; rank++) {
    const slot = movers[rank]
    const base = slot * stride
    const wait = delayOf(rank, n)
    // Whether a key it turns runs anything but the Batch's own spring.
    let ruled = false
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const target = pending[at]
      if (Number.isNaN(target)) continue
      if (target === targets[at]) continue
      let rule = rules[k]
      if (Predicate.isNotUndefined(ruleAt)) rule = ruleAt(slot, k)
      const entry = state.entries[rule]
      if (rule !== 0 || entry.kind !== SPRING) ruled = true
      const before = state.rules[at]
      if (before !== rule) {
        hold(state, rule)
        release(state, before)
        state.rules[at] = rule
      }
      targets[at] = target
      state.origins[at] = state.positions[at]
      state.originVelocities[at] = state.velocities[at]
      state.elapsed[at] = 0
      state.delays[at] = entry.delay + wait
      const distance = target - state.positions[at]
      state.restDeltas[at] = Spring.restDeltaFor(entry.spring, distance)
      state.restSpeeds[at] = Spring.restSpeedFor(entry.spring, distance)
      // A spring that ends at its duration starts from rest, as Motion's (#359).
      if (entry.kind === TIMED) state.velocities[at] = 0
    }
    const flag = flags[slot] & ~COUNTED
    flags[slot] = flag
    if ((flag & (IN_PLAIN | IN_RULED)) === 0) setOff++
    // Into the ruled list, out of the plain one (which drops it at its next step); else into the plain
    // list, if it's in neither.
    if (ruled && (flag & IN_RULED) === 0) {
      flags[slot] = (flag & ~IN_PLAIN) | IN_RULED
      state.ruledList[state.ruledCount] = slot
      state.ruledCount = state.ruledCount + 1
    }
    if (!ruled && (flag & (IN_PLAIN | IN_RULED)) === 0) {
      flags[slot] = flag | IN_PLAIN
      state.plainList[state.plainCount] = slot
      state.plainCount = state.plainCount + 1
    }
  }
  Arr.forEach(held, (rule) => release(state, rule))
  return setOff
})

/** Whether any member moves: one `step` would move. */
export const isMoving = <S>(self: Batch<S>): boolean => {
  const state = stateOf(self)
  return state.plainCount + state.ruledCount > 0
}

/**
 * Steps every moving member by `dt` seconds and writes each one: whether nothing moves now. The run
 * on the Frame loop calls it each tick.
 */
// Per frame (ADR-0025, ADR-0030 decisions 10 and 11): `dt` clamped once (#78), then the two moving
// lists. Each steps a key by `springValues`' exact step, or `Machine.tween`'s, its spring's matrix
// worked out once a frame: called per key, `matrixFor` cost the step 2.5× (#665).
export const step = <S>(self: Batch<S>, dt: number): boolean => {
  const state = stateOf(self)
  const clamped = Math.min(dt, Machine.MAX_DT)
  if (state.plainCount > 0) stepPlain(state, clamped)
  if (state.ruledCount > 0) stepRuled(state, clamped)
  if (state.animations.size > 0) Iter.forEach(state.animations, (animation) => checkLanding(animation))
  state.flush()
  state.onFrame()
  // Counted after `onFrame`: a change it makes keeps the run going.
  if (state.plainCount + state.ruledCount > 0) return false
  // An animation playing, paused at rest, still holds its entries.
  if (state.entries.length > state.pinned && state.animations.size === 0) forgetTransitions(state)
  return true
}

/**
 * At rest, every transition but the Batch's own is forgotten: no member moves, so no rule is read
 * until a change sets it again.
 */
// Once a rest, over every member's key (#665).
const forgetTransitions = <S>(state: State<S>): void => {
  const { pinned, stride } = state
  state.entries.length = pinned
  state.bags.length = pinned
  state.heads.length = pinned
  state.freeRules.length = 0
  state.uses.fill(0)
  state.ruleByBag.clear()
  Arr.forEach(state.bags, (bag, rule) => state.ruleByBag.set(UndefinedOr.getOrThrow(bag), rule))
  // Rest is not the per-frame path: a counted loop over every member's keys, once.
  for (let at = 0; at < state.used * stride; at++) state.rules[at] = state.ownRules[at % stride]
}

/** The members in the plain list, every key on the Batch's own spring, by one matrix. */
// Per frame. The ruled list's loop below, less its read of each key's rule and kind (#665).
const stepPlain = <S>(state: State<S>, clamped: number): void => {
  const { stride, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, plainList, flags, subjects, write } = state
  const spring = state.entries[0].spring
  const m = Spring.matrixFor(spring, clamped)
  const dd = m.dd
  const dv = m.dv
  const vd = m.vd
  const vv = m.vv
  const count = state.plainCount
  let kept = 0
  for (let a = 0; a < count; a++) {
    const slot = plainList[a]
    const flag = flags[slot]
    // A member a change gave another transition is the ruled list's now; one that left is dropped here, unwritten.
    if (flag !== (LIVE | IN_PLAIN)) {
      if ((flag & IN_PLAIN) !== 0) flags[slot] = flag & ~IN_PLAIN
      continue
    }
    const base = slot * stride
    let still = true
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const goal = targets[at]
      const time = elapsed[at] + clamped
      let position = positions[at]
      let speed = velocities[at]
      // Only the part of this tick past the delay moves it: all of it, or, the frame its delay ends, a part.
      const simDt = Math.max(0, Math.min(clamped, time - delays[at]))
      if (simDt === clamped) {
        const d = position - goal
        position = goal + dd * d + dv * speed
        speed = vd * d + vv * speed
      }
      if (simDt > 0 && simDt < clamped) {
        const part = Spring.matrixFor(spring, simDt)
        const d = position - goal
        position = goal + part.dd * d + part.dv * speed
        speed = part.vd * d + part.vv * speed
      }
      const settled = simDt > 0 && Math.abs(speed) <= restSpeeds[at] && Math.abs(position - goal) <= restDeltas[at]
      if (settled) {
        position = goal
        speed = 0
      }
      if (!settled) still = false
      positions[at] = position
      velocities[at] = speed
      elapsed[at] = time
    }
    write(subjects[slot] as S, positions, base)
    // At rest: still its member's, in neither list.
    if (still) {
      flags[slot] = LIVE
      continue
    }
    plainList[kept] = slot
    kept++
  }
  state.plainCount = kept
}

/** A tween's step for the key at `at`, written in place: whether it has landed. */
// Per frame: `Machine.tween`'s value, eased from the key's start, its speed from its last frame.
const stepTween = <S>(state: State<S>, at: number, tween: ResolvedTween, time: number, dt: number): boolean => {
  const delay = state.delays[at]
  const eased = tween.ease(Scalar.clamp(Math.max(0, time - delay) / tween.duration, 0, 1))
  const next = Scalar.lerp(state.origins[at], state.targets[at], eased)
  const landed = time >= delay + tween.duration
  if (landed) state.velocities[at] = 0
  if (!landed && dt > 0) state.velocities[at] = (next - state.positions[at]) / dt
  state.positions[at] = next
  return landed
}

/** The members in the ruled list, each key by the transition its rule names: a spring's matrix, or a tween. */
// Per frame. Each spring entry's matrix for this `dt`, once, then plain reads by rule (#665).
const stepRuled = <S>(state: State<S>, clamped: number): void => {
  const { stride, entries, kinds, matrices, dts, heads, rules, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, ruledList, flags, subjects, write } = state
  // Each entry's step: the frame's, or a driven one's at its Playhead's speed, which moves its time; then
  // each spring's matrix for it, once.
  for (let e = 0; e < entries.length; e++) {
    const kind = kinds[e]
    if (kind === FREE) continue
    let dt = clamped
    const head = heads[e]
    if (Predicate.isNotUndefined(head)) dt = drivenStep(head, clamped)
    dts[e] = dt
    if (kind === TWEEN || dt <= 0) continue
    const m = Spring.matrixFor(entries[e].spring, dt)
    matrices[e * MATRIX] = m.dd
    matrices[e * MATRIX + 1] = m.dv
    matrices[e * MATRIX + 2] = m.vd
    matrices[e * MATRIX + 3] = m.vv
  }
  const count = state.ruledCount
  let kept = 0
  for (let a = 0; a < count; a++) {
    const slot = ruledList[a]
    const flag = flags[slot]
    // A member that left is dropped here, unwritten.
    if ((flag & LIVE) === 0) {
      flags[slot] = flag & ~IN_RULED
      continue
    }
    const base = slot * stride
    let still = true
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const rule = rules[at]
      const kind = kinds[rule]
      const dt = dts[rule]
      // Played backwards: its value worked out again where its Playhead has gone back to, out of line.
      if (dt < 0) {
        if (!stepBack(state, at, rule, dt)) still = false
        continue
      }
      const time = elapsed[at] + dt
      elapsed[at] = time
      // A tween, out of line.
      if (kind === TWEEN) {
        if (!stepTween(state, at, entries[rule].tween, time, dt)) still = false
        continue
      }
      // A spring, as `springValues`': only the part of this tick past the delay moves it.
      const goal = targets[at]
      const delay = delays[at]
      let position = positions[at]
      let speed = velocities[at]
      const simDt = Math.max(0, Math.min(dt, time - delay))
      if (simDt > 0 && simDt === dt) {
        const mi = rule * MATRIX
        const d = position - goal
        position = goal + matrices[mi] * d + matrices[mi + 1] * speed
        speed = matrices[mi + 2] * d + matrices[mi + 3] * speed
      }
      if (simDt > 0 && simDt < dt) {
        const part = Spring.matrixFor(entries[rule].spring, simDt)
        const d = position - goal
        position = goal + part.dd * d + part.dv * speed
        speed = part.vd * d + part.vv * speed
      }
      // A spring rests by its thresholds; one that ends at its duration, there (#359). Held by a paused
      // Playhead, one already on its target is at rest.
      let settled = simDt > 0 && Math.abs(speed) <= restSpeeds[at] && Math.abs(position - goal) <= restDeltas[at]
      if (kind === TIMED) settled = time - delay >= entries[rule].spring.duration
      if (dt === 0) settled = speed === 0 && position === goal && time >= delay
      if (settled) {
        position = goal
        speed = 0
      }
      if (!settled) still = false
      positions[at] = position
      velocities[at] = speed
    }
    write(subjects[slot] as S, positions, base)
    // At rest: still its member's, in neither list (a member is in one at most).
    if (still) {
      flags[slot] = LIVE
      continue
    }
    ruledList[kept] = slot
    kept++
  }
  state.ruledCount = kept
}

// --- A change driven by a Playhead ---------------------------------------------
//
// #665, ADR-0069 decision 15: what `createAnimate`'s Playback controls act on when they animate a Batch.
// The change keeps each of its keys' start, so a seek works its value out where it'd be, exactly, from
// the spring's closed form (`Spring.matrixFor` over the time) or the tween's curve. Its transition is an
// entry of its own whose keys step at its Playhead's speed. A later change of one of its keys takes it,
// as a ward's Retarget takes an Imperative animation's (#433): the change can't land then.

/** A change of a Batch driven by a Playhead: `animate`'s, which `play`, `stop`, `cancel` and `durationOf` take. */
export interface Animation {
  readonly [AnimationTypeId]: typeof AnimationTypeId
}

const AnimationTypeId = "~@wardic/core/Batch/Animation"

/** `animate`'s options: a change's, and its Playhead, its first stops and its landing's callback. */
export interface AnimateOptions extends RetargetOptions {
  /** What drives it: its keys step at its speed, hold while it's paused, and move its time. */
  readonly head: Playback.Playhead
  /** Each member's key's first stop, `NaN` for where it is: it starts there, from rest. */
  readonly from?: (slot: number, k: number) => number
  /** Called once every key it moves has landed while it still moves it. */
  readonly onLanded?: () => void
}

/** An animation's state: its change, worked out at its first play, and what it moves. */
interface AnimationState<S> {
  readonly [AnimationTypeId]: typeof AnimationTypeId
  readonly state: State<S>
  /** Its transition, its own object, so its entry is its own. */
  readonly bag: Transition | ((slot: number, k: number) => Transition)
  readonly options: AnimateOptions
  readonly slots: ReadonlyArray<number>
  readonly targetOf: (slot: number, k: number) => number
  /** Its keys, by index into the Batch's arrays, and each one's start, its speed then, its target and its delay. */
  ats: Int32Array
  starts: Float64Array
  speeds: Float64Array
  goals: Float64Array
  waits: Float64Array
  /** Each of its keys' entry while it plays. */
  rules: Uint16Array
  started: boolean
  playing: boolean
  duration: number | undefined
}

/** An entry's step for a driven change: the frame's at its Playhead's speed, 0 while it's paused, which moves its time. */
// Per frame, per driven entry: as `Playback.drive`'s, each step at most `MAX_DT` either way.
const drivenStep = (head: Playback.Playhead, clamped: number): number => {
  if (head.paused) return 0
  const by = Math.max(-Machine.MAX_DT, Math.min(Machine.MAX_DT, clamped * head.speed))
  const writable = head as unknown as { time: number }
  writable.time = Math.max(0, head.time + by)
  return by
}

/**
 * The key at `at`'s value and speed at `time` into its change, from its start: a spring's by its closed
 * form, a tween's by its curve. Whether it has landed there.
 */
const valueAt = <S>(state: State<S>, at: number, rule: number, time: number): boolean => {
  const entry = state.entries[rule]
  const delay = state.delays[at]
  const goal = state.targets[at]
  const from = state.origins[at]
  const active = Math.max(0, time - delay)
  if (entry.kind === TWEEN) {
    const tween = entry.tween
    const landed = time >= delay + tween.duration
    const at0 = Scalar.lerp(from, goal, tween.ease(Scalar.clamp(active / tween.duration, 0, 1)))
    const before = Scalar.lerp(from, goal, tween.ease(Scalar.clamp(Math.max(0, active - CATCH_UP) / tween.duration, 0, 1)))
    state.positions[at] = at0
    state.velocities[at] = (at0 - before) / CATCH_UP
    if (landed) state.velocities[at] = 0
    return landed
  }
  if (active === 0) {
    state.positions[at] = from
    state.velocities[at] = state.originVelocities[at]
    return false
  }
  const m = Spring.matrixFor(entry.spring, active)
  const d = from - goal
  const v0 = state.originVelocities[at]
  let position = goal + m.dd * d + m.dv * v0
  let speed = m.vd * d + m.vv * v0
  let landed = Math.abs(speed) <= state.restSpeeds[at] && Math.abs(position - goal) <= state.restDeltas[at]
  if (entry.kind === TIMED) landed = active >= entry.spring.duration
  if (landed) {
    position = goal
    speed = 0
  }
  state.positions[at] = position
  state.velocities[at] = speed
  return landed
}

/** A step's time, a frame at 60 Hz: what a tween's speed is worked out over, and `durationOf` steps by. */
const CATCH_UP = Machine.CATCH_UP_DT

/** A key played backwards by `dt`: its value where its Playhead went back to; at its start, at rest there. */
// Per frame, per key of a change played backwards: rare, so out of line.
const stepBack = <S>(state: State<S>, at: number, rule: number, dt: number): boolean => {
  const time = Math.max(0, state.elapsed[at] + dt)
  state.elapsed[at] = time
  valueAt(state, at, rule, time)
  if (time > 0) return false
  state.positions[at] = state.origins[at]
  state.velocities[at] = 0
  return true
}

/** Whether `animation` still moves the key at its `i`th: on its entry, toward its target. */
const holds = <S>(animation: AnimationState<S>, i: number): boolean => {
  const at = animation.ats[i]
  return animation.state.rules[at] === animation.rules[i] && animation.state.targets[at] === animation.goals[i]
}

/** It stops playing: its entry steps at the frame's pace again, and the table may let it go. */
const finish = <S>(animation: AnimationState<S>): void => {
  if (!animation.playing) return
  animation.playing = false
  animation.state.animations.delete(animation)
  Arr.forEach(Arr.dedupe(Arr.fromIterable(animation.rules)), (rule) => {
    animation.state.heads[rule] = undefined
    release(animation.state, rule)
  })
}

/**
 * Whether `animation` has landed, once a frame while it plays: every key it moves at its target, past its
 * delay, while it still moves it; or, played backwards, back at its start. A key a later change took
 * keeps it from landing (#433's latest-wins, as a ward's).
 */
const checkLanding = <S>(animation: AnimationState<S>): void => {
  const { state, options } = animation
  const head = options.head
  const count = animation.ats.length
  let landed = true
  let held = 0
  // Once a frame, per key of a playing change: a counted loop with plain reads.
  for (let i = 0; i < count; i++) {
    if (!holds(animation, i)) {
      landed = false
      continue
    }
    held++
    const at = animation.ats[i]
    if (head.speed < 0) continue
    if (state.velocities[at] !== 0 || state.positions[at] !== animation.goals[i] || state.elapsed[at] < animation.waits[i]) landed = false
  }
  // Every key taken by later changes: it plays nothing now, and can't land.
  if (count > 0 && held === 0) {
    finish(animation)
    return
  }
  if (head.speed < 0 && head.time > 0) return
  if (!landed) return
  finish(animation)
  UndefinedOr.map(options.onLanded, (told) => told())
}

/**
 * A change of `slots`' members toward `targetOf(slot, k)`, driven by `options.head`: nothing moves until
 * it's played. Its controls are `play`, `stop`, `cancel` and `durationOf`.
 *
 * @example
 * const head = Playback.make()
 * const shuffle = Batch.animate(grid, slots, (slot, k) => cellOf(slot)[k], { head, transition: { type: "spring" } })
 * Batch.play(shuffle)
 */
export const animate = <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options: AnimateOptions): Animation => {
  const state = stateOf(self)
  const given = options.transition
  // Its own objects, so its entries, and the Playhead that drives them, are its alone: a copy of each
  // transition it runs, its keys' own when it gives none. A function's bags are its caller's to make so.
  const copies = new Map<Transition, Transition>()
  const copyOf = (transition: Transition): Transition => {
    const known = copies.get(transition)
    if (Predicate.isNotUndefined(known)) return known
    const made = { ...transition } as Transition
    copies.set(transition, made)
    return made
  }
  let bag: Transition | ((slot: number, k: number) => Transition) = (_, k) => copyOf(UndefinedOr.getOrThrow(state.bags[state.ownRules[k]]))
  if (Predicate.isFunction(given)) bag = given
  if (Predicate.isNotUndefined(given) && !Predicate.isFunction(given)) {
    const transitions = given
    if (isTransition(transitions)) bag = copyOf(transitions)
    if (!isTransition(transitions)) {
      bag = (_, k) => {
        const key = state.keys[k]
        const own = transitions[key]
        if (Predicate.isNotUndefined(own)) return copyOf(own)
        const otherwise = transitions["default"]
        if (Predicate.isNotUndefined(otherwise)) return copyOf(otherwise)
        return copyOf(UndefinedOr.getOrThrow(state.bags[state.ownRules[k]]))
      }
    }
  }
  const animation: AnimationState<S> = {
    [AnimationTypeId]: AnimationTypeId,
    state,
    bag,
    options,
    slots,
    targetOf,
    ats: new Int32Array(0),
    starts: new Float64Array(0),
    speeds: new Float64Array(0),
    goals: new Float64Array(0),
    waits: new Float64Array(0),
    rules: new Uint16Array(0),
    started: false,
    playing: false,
    duration: undefined,
  }
  return animation
}

/** An animation's transition for the key `k` of the member at `slot`: its own, or the Batch's per-key one. */
const animationBagOf = <S>(animation: AnimationState<S>, slot: number, k: number): Transition => {
  const bag = animation.bag
  if (Predicate.isFunction(bag)) return bag(slot, k)
  return bag
}

/** Its change worked out, once, at its first play: the keys it moves, where each starts, its target and delay. */
const startOf = <S>(animation: AnimationState<S>): void => {
  const { state, slots, targetOf, options } = animation
  const { stride } = state
  const delayOf = delayOfChange(options.delay)
  const from = options.from
  const ats: Array<number> = []
  const starts: Array<number> = []
  const speeds: Array<number> = []
  const goals: Array<number> = []
  const movers: Array<number> = []
  const firsts: Array<number> = []
  // Once an animation, per member and key: which move, by rank for the delays.
  Arr.forEach(slots, (slot) => {
    if ((state.flags[slot] & LIVE) === 0) return
    let moves = false
    const first = ats.length
    for (let k = 0; k < stride; k++) {
      const at = slot * stride + k
      const target = targetOf(slot, k)
      if (Number.isNaN(target)) continue
      let start = state.positions[at]
      let speed = state.velocities[at]
      let jumps = false
      if (Predicate.isNotUndefined(from)) {
        const stop = from(slot, k)
        if (!Number.isNaN(stop)) {
          start = stop
          speed = 0
          jumps = true
        }
      }
      if (!jumps && target === state.targets[at]) continue
      moves = true
      ats.push(at)
      starts.push(start)
      speeds.push(speed)
      goals.push(target)
    }
    if (!moves) return
    movers.push(slot)
    firsts.push(first)
  })
  const n = movers.length
  // Each mover's keys are its run of `ats`, from its first: each waits by the mover's rank.
  const waits: Array<number> = Arr.map(ats, () => 0)
  Arr.forEach(movers, (_, rank) => {
    const wait = delayOf(rank, n)
    let last = ats.length
    if (rank + 1 < n) last = firsts[rank + 1]
    for (let i = firsts[rank]; i < last; i++) waits[i] = wait
  })
  animation.ats = Int32Array.from(ats)
  animation.starts = Float64Array.from(starts)
  animation.speeds = Float64Array.from(speeds)
  animation.goals = Float64Array.from(goals)
  animation.waits = Float64Array.from(waits)
  animation.rules = new Uint16Array(ats.length)
  animation.started = true
}

/**
 * Plays `animation` from its Playhead's time: from its start at 0, its change worked out then, and from
 * wherever a seek put the time, every key it moves taken again there.
 */
export const play = (self: Animation): void => {
  const animation = self as unknown as AnimationState<unknown>
  const { state, options } = animation
  if (!animation.started) startOf(animation)
  finish(animation)
  const time = options.head.time
  const count = animation.ats.length
  animation.playing = true
  state.animations.add(animation)
  // Each key's entry, and each entry it drives held once for it and driven by its Playhead.
  for (let i = 0; i < count; i++) {
    const at = animation.ats[i]
    const slot = Math.floor(at / state.stride)
    animation.rules[i] = ruleFor(state, animationBagOf(animation, slot, at - slot * state.stride))
  }
  Arr.forEach(Arr.dedupe(Arr.fromIterable(animation.rules)), (rule) => {
    hold(state, rule)
    state.heads[rule] = options.head
  })
  // Once a play, per key it moves.
  for (let i = 0; i < count; i++) {
    const at = animation.ats[i]
    const slot = Math.floor(at / state.stride)
    const rule = animation.rules[i]
    const entry = state.entries[rule]
    const before = state.rules[at]
    if (before !== rule) {
      hold(state, rule)
      release(state, before)
      state.rules[at] = rule
    }
    const goal = animation.goals[i]
    state.targets[at] = goal
    state.origins[at] = animation.starts[i]
    state.originVelocities[at] = animation.speeds[i]
    state.delays[at] = entry.delay + animation.waits[i]
    const distance = goal - animation.starts[i]
    state.restDeltas[at] = Spring.restDeltaFor(entry.spring, distance)
    state.restSpeeds[at] = Spring.restSpeedFor(entry.spring, distance)
    // A spring that ends at its duration starts from rest, as Motion's (#359).
    if (entry.kind === TIMED) state.originVelocities[at] = 0
    state.elapsed[at] = time
    valueAt(state, at, rule, time)
    moving(state, slot)
  }
}

/** The member at `slot` moving in the ruled list, so the next step draws it and rests it. */
const moving = <S>(state: State<S>, slot: number): void => {
  const flag = state.flags[slot]
  if ((flag & IN_RULED) !== 0) return
  state.flags[slot] = (flag & ~IN_PLAIN) | IN_RULED
  state.ruledList[state.ruledCount] = slot
  state.ruledCount = state.ruledCount + 1
}

/** Ends `animation` where it is: the keys it moves stay there, at rest. */
export const stop = (self: Animation): void => {
  const animation = self as unknown as AnimationState<unknown>
  const { state } = animation
  // Once a stop, per key it moves.
  for (let i = 0; animation.playing && i < animation.ats.length; i++) {
    if (!holds(animation, i)) continue
    const at = animation.ats[i]
    state.targets[at] = state.positions[at]
    state.velocities[at] = 0
    state.elapsed[at] = Math.max(state.elapsed[at], state.delays[at])
    moving(state, Math.floor(at / state.stride))
  }
  finish(animation)
}

/** Ends `animation`, and puts the keys it moved back where it started them, at rest. */
export const cancel = (self: Animation): void => {
  const animation = self as unknown as AnimationState<unknown>
  const { state } = animation
  // Once a cancel, per key it moved: one a later change took stays that change's.
  for (let i = 0; i < animation.ats.length; i++) {
    const at = animation.ats[i]
    if (state.targets[at] !== animation.goals[i]) continue
    state.positions[at] = animation.starts[i]
    state.targets[at] = animation.starts[i]
    state.velocities[at] = 0
    state.elapsed[at] = Math.max(state.elapsed[at], state.delays[at])
    moving(state, Math.floor(at / state.stride))
  }
  finish(animation)
}

/**
 * How long `animation` runs, in seconds: its longest key's, a spring's until it rests, stepped from its
 * start at 60 Hz as `Machine.durationOf` steps a machine. Worked out once.
 */
export const durationOf = (self: Animation): number => {
  const animation = self as unknown as AnimationState<unknown>
  if (Predicate.isNotUndefined(animation.duration)) return animation.duration
  const { state } = animation
  if (!animation.started) startOf(animation)
  const most = Math.ceil(Machine.MAX_DURATION / CATCH_UP)
  let longest = 0
  // Once an animation, per key: a counted loop to its rest.
  for (let i = 0; i < animation.ats.length; i++) {
    const at = animation.ats[i]
    const slot = Math.floor(at / state.stride)
    const entry = entryFor(animationBagOf(animation, slot, at - slot * state.stride))
    const delay = entry.delay + animation.waits[i]
    const goal = animation.goals[i]
    const distance = goal - animation.starts[i]
    if (entry.kind === TWEEN) {
      longest = Math.max(longest, Math.ceil((delay + entry.tween.duration) / CATCH_UP - 1e-9) * CATCH_UP)
      continue
    }
    if (entry.kind === TIMED) {
      longest = Math.max(longest, Math.ceil((delay + entry.spring.duration) / CATCH_UP - 1e-9) * CATCH_UP)
      continue
    }
    const restDelta = Spring.restDeltaFor(entry.spring, distance)
    const restSpeed = Spring.restSpeedFor(entry.spring, distance)
    let position = animation.starts[i]
    let speed = animation.speeds[i]
    let time = 0
    let steps = most
    for (let f = 1; f <= most; f++) {
      time += CATCH_UP
      const simDt = Math.max(0, Math.min(CATCH_UP, time - delay))
      if (simDt > 0) {
        const m = Spring.matrixFor(entry.spring, simDt)
        const d = position - goal
        position = goal + m.dd * d + m.dv * speed
        speed = m.vd * d + m.vv * speed
        if (Math.abs(speed) <= restSpeed && Math.abs(position - goal) <= restDelta) {
          steps = f
          break
        }
      }
    }
    longest = Math.max(longest, steps * CATCH_UP)
  }
  animation.duration = longest
  return longest
}

/** A sink that keeps nothing: a Batch's run writes as it steps. */
const ignore = (): undefined => undefined

/** `self`'s run numbered `id`: a step each tick, until nothing moves. */
const machineOf = <S>(self: Batch<S>, id: number): Machine.Machine<Frame.Frame<number>> => {
  const state = stateOf(self)
  return Machine.make({
    settles: true,
    span: { name: "wardic.batch", attributes: { keys: state.stride } },
    start: () => {
      const frame = { value: 0, done: false }
      // Per frame (ADR-0025): the step, and its count of members moving.
      return (dt) => {
        const done = step(self, dt)
        frame.value = state.plainCount + state.ruledCount
        if (!done) return frame
        frame.done = true
        // Marked ended in the step that rests, so a change later in the same tick starts the next run.
        if (state.running === id) state.running = 0
        return frame
      }
    },
  })
}

/**
 * Runs `self` on the Frame loop while any member moves, from the next tick: each tick steps every
 * moving member and writes it. It succeeds once nothing moves. While one runs, another does nothing,
 * so a binding calls it after each change.
 *
 * @example
 * Batch.retarget(grid, slots, targetOf)
 * runtime.runFork(Batch.run(grid))
 */
// One run, not a fiber per member (ADR-0069, decision 10). Its span is `wardic.batch`.
export const run = <S>(self: Batch<S>): Effect.Effect<void, never, FrameLoop.FrameLoop> =>
  Effect.suspend(() => {
    const state = stateOf(self)
    if (state.running !== 0) return Effect.void
    if (state.plainCount + state.ruledCount === 0) return Effect.void
    const id = state.runs + 1
    state.runs = id
    state.running = id
    return Effect.ensuring(
      Effect.asVoid(Machine.run(machineOf(self, id), ignore)),
      Effect.sync(() => {
        if (state.running === id) state.running = 0
      }),
    )
  })

/** `key`'s index among `state`'s keys, or a throw naming it. */
const keyAt = <S>(state: State<S>, key: string): number => {
  const k = state.indexOfKey[key]
  if (Predicate.isNotUndefined(k)) return k
  throw new Machine.OptionError({ message: `Expected one of the Batch's keys, got ${JSON.stringify(key)}\n  at ["key"]` })
}

/** A member's value for `key` now. */
// Per frame: a sink may read it for every member.
export const get = <S>(self: Batch<S>, slot: number, key: string): number => {
  const state = stateOf(self)
  return state.positions[slot * state.stride + keyAt(state, key)]
}

/** A member's velocity for `key` now, per second: what an animation that takes the key over starts with. */
// Per frame, as `get`.
export const velocity = <S>(self: Batch<S>, slot: number, key: string): number => {
  const state = stateOf(self)
  return state.velocities[slot * state.stride + keyAt(state, key)]
}
