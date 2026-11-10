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
import * as Match from "effect/Match"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type { Invariant } from "effect/Types"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Frame from "./Frame.ts"
import type * as FrameLoop from "./FrameLoop.ts"
import * as Machine from "./Machine.ts"
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
  /** Where each member's key started its tween. */
  origins: Float64Array
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
  }
  state.entries[rule] = entry
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
  state.kinds[rule] = FREE
  state.ruleByBag.delete(UndefinedOr.getOrThrow(state.bags[rule]))
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
  state.flush()
  state.onFrame()
  // Counted after `onFrame`: a change it makes keeps the run going.
  if (state.plainCount + state.ruledCount > 0) return false
  if (state.entries.length > state.pinned) forgetTransitions(state)
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
const stepTween = <S>(state: State<S>, at: number, tween: ResolvedTween, time: number, clamped: number): boolean => {
  const delay = state.delays[at]
  const eased = tween.ease(Scalar.clamp(Math.max(0, time - delay) / tween.duration, 0, 1))
  const next = Scalar.lerp(state.origins[at], state.targets[at], eased)
  const landed = time >= delay + tween.duration
  if (landed) state.velocities[at] = 0
  if (!landed && clamped > 0) state.velocities[at] = (next - state.positions[at]) / clamped
  state.positions[at] = next
  return landed
}

/** The members in the ruled list, each key by the transition its rule names: a spring's matrix, or a tween. */
// Per frame. Each spring entry's matrix for this `dt`, once, then plain reads by rule (#665).
const stepRuled = <S>(state: State<S>, clamped: number): void => {
  const { stride, entries, kinds, matrices, rules, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, ruledList, flags, subjects, write } = state
  for (let e = 0; e < entries.length; e++) {
    const kind = kinds[e]
    if (kind === TWEEN || kind === FREE) continue
    const m = Spring.matrixFor(entries[e].spring, clamped)
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
      const time = elapsed[at] + clamped
      elapsed[at] = time
      // A tween, out of line.
      if (kind === TWEEN) {
        if (!stepTween(state, at, entries[rule].tween, time, clamped)) still = false
        continue
      }
      // A spring, as `springValues`': only the part of this tick past the delay moves it.
      const goal = targets[at]
      const delay = delays[at]
      let position = positions[at]
      let speed = velocities[at]
      const simDt = Math.max(0, Math.min(clamped, time - delay))
      if (simDt === clamped) {
        const mi = rule * MATRIX
        const d = position - goal
        position = goal + matrices[mi] * d + matrices[mi + 1] * speed
        speed = matrices[mi + 2] * d + matrices[mi + 3] * speed
      }
      if (simDt > 0 && simDt < clamped) {
        const part = Spring.matrixFor(entries[rule].spring, simDt)
        const d = position - goal
        position = goal + part.dd * d + part.dv * speed
        speed = part.vd * d + part.vv * speed
      }
      // A spring rests by its thresholds; one that ends at its duration, there (#359).
      let settled = simDt > 0 && Math.abs(speed) <= restSpeeds[at] && Math.abs(position - goal) <= restDeltas[at]
      if (kind === TIMED) settled = time - delay >= entries[rule].spring.duration
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
