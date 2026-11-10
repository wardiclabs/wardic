/**
 * A Batch: many Subjects animated on the same keys as one run on the Frame loop, for a list, a grid or
 * a chart's points that move together. Each member's values, velocities and targets are kept by
 * index, so a new target turns every member toward it at the speed it already has, and a change
 * costs an array write per member, not an animation each. An Environment's writer draws each member
 * as it moves. A change can be driven by a Playhead, as Playback controls drive an animation, toward
 * targets (`animate`) or through each member's key's own stops (`keyframes`, a sequence's Segment).
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
import type * as Easing from "./Easing.ts"
import type * as Frame from "./Frame.ts"
import type * as FrameLoop from "./FrameLoop.ts"
import * as Machine from "./Machine.ts"
import type * as Playback from "./Playback.ts"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"
import { dual } from "./internal/dual.ts"
import { tickOf, writableOf } from "./internal/playhead.ts"
import { resolveKeyframes } from "./internal/keyframes.ts"
import { checked, fn, literals, nonNegative, positive, union } from "./internal/options.ts"
import { keyframeAt, type Pass, passAt, type ResolvedRun, type ResolvedTween, stopTimesOf } from "./internal/stepper.ts"

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
  /**
   * Where a member's key starts from, `NaN` for where it is: it starts there, at `velocity`'s speed (0
   * when it gives none), toward its target, the one it has when `targetOf` gives `NaN`. For a driver
   * handing a member's keys back.
   */
  // #665's PR 4 (ADR-0069 decision 17): the Batch takes a key back from the member's value and speed.
  readonly from?: (slot: number, k: number) => number
  /** Each started key's speed, with `from`. */
  readonly velocity?: (slot: number, k: number) => number
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

/**
 * An entry's kind: a spring, a tween, a spring that ends at its `duration`, a freed entry, or a driven
 * change's keyframes, each of its keys through stops of its own.
 */
// #359: a spring set by duration lands there. #665, Q36: keyframes, a Sequence's Segment of a Batch.
const SPRING = 0
const TWEEN = 1
const TIMED = 2
const FREE = 3
const KEYFRAMES = 4

/** Numbers in a spring entry's matrix for this frame: `dd`, `dv`, `vd`, `vv`. */
const MATRIX = 4

/** How many entries a table holds before it grows. */
const TABLE_START = 8

/** The most entries a table holds at once: a rule is a `Uint16Array`'s. */
const TABLE_MAX = 65536

/** A transition in a Batch's table, resolved once: a spring's physics, or a tween's curve. */
interface Entry {
  readonly kind: typeof SPRING | typeof TWEEN | typeof TIMED | typeof KEYFRAMES
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
  /** Each entry's driven change, while it plays: the entry's keys step at its Playhead's speed. */
  readonly drivers: Array<AnimationState<S> | undefined>
  /** Each entry's step this frame: the frame's `dt`, or a driven entry's at its Playhead's speed. */
  dts: Float64Array
  /** The animations playing, each checked for its landing once a frame. */
  readonly animations: Set<AnimationState<S>>
  /** The bag each entry was given as: a transition, or a keyframes change's own. */
  readonly bags: Array<object | undefined>
  /** Each entry's rule, by the bag it was given as. */
  readonly ruleByBag: Map<object, number>
  /** The freed entries, the next transition's. */
  readonly freeRules: Array<number>
  /** How many entries are the Batch's own, never freed: the first. */
  pinned: number
  /** Each key's own rule: what it runs when a change gives it none. */
  ownRules: ReadonlyArray<number>
  readonly write: (subject: S, positions: Float64Array, base: number) => void
  readonly flush: () => void
  readonly onFrame: () => void
  /** How many steps it has taken: a driven change works its tick out once in each. */
  frame: number
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
  return entryRuleOf(state, transition, entryFor(transition))
}

/** A new entry for `bag` in `state`'s table: its rule, a freed one if there is one. */
const entryRuleOf = <S>(state: State<S>, bag: object, entry: Entry): number => {
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
  state.drivers[rule] = undefined
  state.bags[rule] = bag
  state.kinds[rule] = entry.kind
  state.uses[rule] = 0
  state.ruleByBag.set(bag, rule)
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

/** `transitions`' bag for each of `state`'s keys, by index: its own, or its `default`; `undefined` where it gives neither. */
// Once a change, per key.
const bagsOf = <S>(state: State<S>, transitions: Transitions): ReadonlyArray<Transition | undefined> => {
  if (isTransition(transitions)) return Arr.map(state.keys, () => transitions)
  return Arr.map(state.keys, (key) => {
    const given = transitions[key]
    if (Predicate.isNotUndefined(given)) return given
    return transitions["default"]
  })
}

/** `transitions`' rule for each of `state`'s keys, by index; a key it doesn't name, nor its `default`, takes `fallback`'s. */
const rulesOf = <S>(state: State<S>, transitions: Transitions, fallback: (k: number) => number): ReadonlyArray<number> =>
  Arr.map(bagsOf(state, transitions), (bag, k) => {
    if (Predicate.isUndefined(bag)) return fallback(k)
    return ruleFor(state, bag)
  })

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
    drivers: [],
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
    frame: 0,
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
 * The key at `at` turned on `rule` toward `goal`, from `start` at `speed`, waiting `wait` past its
 * transition's own delay: its rule held, and its start, its speed then and its rest thresholds kept.
 * A driven change's, at its play; `retarget` keeps the same writes inline, less the speed.
 */
// Per key a driven change plays: plain writes.
const turn = <S>(state: State<S>, at: number, rule: number, goal: number, start: number, speed: number, wait: number): void => {
  const entry = state.entries[rule]
  const before = state.rules[at]
  if (before !== rule) {
    hold(state, rule)
    release(state, before)
    state.rules[at] = rule
  }
  state.targets[at] = goal
  state.origins[at] = start
  state.originVelocities[at] = speed
  state.delays[at] = entry.delay + wait
  const distance = goal - start
  state.restDeltas[at] = Spring.restDeltaFor(entry.spring, distance)
  state.restSpeeds[at] = Spring.restSpeedFor(entry.spring, distance)
  // A spring that ends at its duration starts from rest, as Motion's (#359).
  if (entry.kind !== TIMED) return
  state.velocities[at] = 0
  state.originVelocities[at] = 0
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
  const fromOf = UndefinedOr.map(options, (bag) => bag.from)
  const starts = Predicate.isNotUndefined(fromOf)
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
      // Started from a value given, it moves, onto the target it has too.
      if (starts && !Number.isNaN((fromOf as (slot: number, k: number) => number)(slot, k))) moves = true
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
  const driven = state.animations.size > 0
  const speedOf = UndefinedOr.map(options, (bag) => bag.velocity)
  let setOff = 0
  for (let rank = 0; rank < n; rank++) {
    const slot = movers[rank]
    const base = slot * stride
    const wait = delayOf(rank, n)
    // Whether a key it turns runs anything but the Batch's own spring.
    let ruled = false
    for (let k = 0; k < stride; k++) {
      const at = base + k
      let target = pending[at]
      // A key started from a value given: there, at its speed, toward its target, the one it has unless a new one's given.
      let jump = Number.NaN
      if (starts) jump = (fromOf as (slot: number, k: number) => number)(slot, k)
      const jumps = !Number.isNaN(jump)
      if (Number.isNaN(target) && !jumps) continue
      if (Number.isNaN(target)) target = targets[at]
      if (target === targets[at] && !jumps) continue
      if (jumps) {
        state.positions[at] = jump
        state.velocities[at] = 0
        if (Predicate.isNotUndefined(speedOf)) state.velocities[at] = speedOf(slot, k)
      }
      let rule = rules[k]
      if (Predicate.isNotUndefined(ruleAt)) rule = ruleAt(slot, k)
      const entry = state.entries[rule]
      if (rule !== 0 || entry.kind !== SPRING) ruled = true
      // Taken from a driven change its Playhead holds, it starts from rest (#464).
      if (driven && heldAt(state, at)) state.velocities[at] = 0
      // `turn`'s body, inline, less its start's speed, which only a driven change reads, and sets at its play.
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
  state.frame = state.frame + 1
  if (state.plainCount > 0) stepPlain(state, clamped)
  if (state.ruledCount > 0) stepRuled(state, clamped)
  if (state.animations.size > 0) Iter.forEach(state.animations, checkLanding)
  state.flush()
  state.onFrame()
  // Counted after `onFrame`: a change it makes keeps the run going.
  if (state.plainCount + state.ruledCount > 0) return false
  // A driven change playing, paused at rest, still holds its entries.
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
  state.drivers.length = pinned
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
  const { stride, entries, kinds, matrices, dts, drivers, rules, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, ruledList, flags, subjects, write } = state
  // Each entry's step: the frame's, or a driven change's at its Playhead's speed, which moves its time;
  // then each spring's matrix for it, once.
  let driven = false
  for (let e = 0; e < entries.length; e++) {
    const kind = kinds[e]
    if (kind === FREE) continue
    let dt = clamped
    const driver = drivers[e]
    if (Predicate.isNotUndefined(driver)) {
      driven = true
      dt = drivenStep(driver, clamped, state.frame)
    }
    dts[e] = dt
    if (kind === TWEEN || dt <= 0) continue
    const m = Spring.matrixFor(entries[e].spring, dt)
    matrices[e * MATRIX] = m.dd
    matrices[e * MATRIX + 1] = m.dv
    matrices[e * MATRIX + 2] = m.vd
    matrices[e * MATRIX + 3] = m.vv
  }
  // While a driven change plays, each key steps by its entry's own step, out of line: read per key, it
  // cost every ruled member's step 5% (Bun and Chromium, 10,000 members; #665).
  if (driven) {
    stepRuledDriven(state)
    return
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

/** The members in the ruled list while a driven change plays: each key by its entry's step this frame, forwards or back. */
// Per frame, while a driven change plays: `stepRuled`'s loop, by each entry's `dt`.
const stepRuledDriven = <S>(state: State<S>): void => {
  const { stride, entries, kinds, matrices, dts, rules, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, ruledList, flags, subjects, write } = state
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
      // Keyframes, out of line: only a driven change's.
      if (kind === KEYFRAMES) {
        if (!stepKeyframes(state, at, rule, time, dt)) still = false
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
// the spring's closed form (`Spring.matrixFor` over the time) or the tween's curve. Its transitions are
// entries of its own whose keys step at its Playhead's speed. A later change of one of its keys takes it,
// as a ward's Retarget takes an Imperative animation's (#433): the change can't land then. Keyframes
// (Q36): a Sequence's Segment of a Batch, each key through its own stops, on one entry of the change's.

const AnimationTypeId = "~@wardic/core/Batch/Animation"

/** A change of a Batch driven by a Playhead: built by `animate`, which `play`, `stop`, `cancel` and `durationOf` take. */
// The Batch module's second data type, so its TypeId names it after the module's (pipeable.md, rule 2).
export interface Animation extends Pipeable, Inspectable.Inspectable {
  readonly [AnimationTypeId]: typeof AnimationTypeId
}

/** `animate`'s options: a change's, and its Playhead, its first stops and its landing's callback. */
export interface AnimateOptions extends RetargetOptions {
  /** What drives it: its keys step at its speed, hold while it's paused, and move its time. */
  readonly head: Playback.Playhead
  /** Each member's key's first stop, `NaN` for where it is: it starts there, from rest. */
  readonly from?: (slot: number, k: number) => number
  /** Called once every key it moves has landed while it still moves it, or at its play when it moves none. */
  readonly onLanded?: () => void
  /**
   * Called for each member it's given, once, as every key of it it still moves has landed: at its
   * first play for a member it moves nothing of; never for one whose keys a later change took.
   */
  // #665, Q47: a keyed Batch's leavers, each removed as its own exit lands.
  readonly onMemberLanded?: (slot: number) => void
}

/**
 * A member's key's keyframes, for `keyframes`: its stops, `NaN` for the stop before (the key's value at
 * its first play, first), and the run through them, as `Machine.keyframes` takes them.
 */
export interface Keyframes {
  readonly stops: ReadonlyArray<number>
  readonly transition: Machine.KeyframesOptions
}

/** `keyframes`' options: its Playhead, and its landing's callback. */
export interface KeyframesOptions {
  /** What drives it: its keys step at its speed, hold while it's paused, and move its time. */
  readonly head: Playback.Playhead
  /** Called once every key it moves has reached its last stop while it still moves it, or at its play when it moves none. */
  readonly onLanded?: () => void
}

/** A key's keyframes in a driven change, resolved at its first play: its stops filled, their times, its easings and its run. */
interface Track {
  readonly stops: Float64Array
  readonly stopTimes: ReadonlyArray<number>
  readonly eases: ReadonlyArray<Easing.Easing>
  readonly run: ResolvedRun
  readonly reverse: boolean
  readonly delay: number
  /** When it ends, from its start: its delay and its run, `Infinity` for one that repeats for ever. */
  readonly end: number
}

/** An animation's state: its change, worked out at its first play, and what it moves. */
interface AnimationState<S> {
  readonly state: State<S>
  /** Its transition for a member's key: its own copy, so its entry, and the Playhead driving it, are its alone. */
  readonly bag: (slot: number, k: number) => Transition
  readonly options: AnimateOptions
  readonly slots: ReadonlyArray<number>
  readonly targetOf: (slot: number, k: number) => number
  /** Each member's key's keyframes: a `keyframes` change's, in place of its targets and transitions. */
  readonly keyframesOf: ((slot: number, k: number) => Keyframes | undefined) | undefined
  /** A `keyframes` change's track for each of its keys, by its index in `ats`, and that index by the key's place in the Batch's arrays. */
  tracks: ReadonlyArray<Track>
  indexAt: Int32Array
  /** Its keys, by index into the Batch's arrays, and each one's start, its speed then, its target and its wait. */
  ats: Int32Array
  starts: Float64Array
  speeds: Float64Array
  goals: Float64Array
  waits: Float64Array
  /** Each of its keys' entry while it plays, and its distinct entries, each held once for it. */
  rules: Uint16Array
  held: ReadonlyArray<number>
  started: boolean
  playing: boolean
  duration: number | undefined
  /** Its time, as a driven machine keeps its own (`Playback.drive`), and its Playhead's after each step. */
  time: number
  /** The step its tick was last worked out in, and that tick: once a step, whatever entries it drives. */
  frame: number
  dt: number
  /** Played from partway through: its first step lands where it was played from, as a driven machine's (`Playback.drive`). */
  landing: boolean
  /** Each member it moves, by rank, its first key's index in `ats`, and one past the last's; whether each has been told it landed. */
  firsts: Int32Array
  told: Uint8Array
  /** The members it's given that it moves nothing of, told they landed at its first play. */
  idle: ReadonlyArray<number>
  idleTold: boolean
}

const AnimationProto = {
  [AnimationTypeId]: AnimationTypeId,
  ...Inspectable.BaseProto,
  toJSON(this: AnimationState<unknown>) {
    return { _id: "Batch.Animation", keys: this.ats.length, playing: this.playing }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/** Whether `u` is a Batch's Animation. */
export const isAnimation = (u: unknown): u is Animation => Predicate.hasProperty(u, AnimationTypeId)

const animationOf = (self: Animation): AnimationState<unknown> => self as unknown as AnimationState<unknown>

/** The slot whose key is at `at`. */
const slotAt = <S>(state: State<S>, at: number): number => Math.floor(at / state.stride)

/** A step's time, a frame at 60 Hz: what a tween's speed is worked out over, and `durationOf` steps by. */
const FRAME = Machine.CATCH_UP_DT

/**
 * A driven change's tick this step: the frame's at its Playhead's speed, 0 while it's paused. Worked out
 * once a step, however many entries it drives, which moves its time and its Playhead's.
 */
// Per frame, per driven entry: as `Playback.drive`'s, its own time kept and written (#433).
const drivenStep = <S>(animation: AnimationState<S>, clamped: number, frame: number): number => {
  if (animation.frame === frame) return animation.dt
  animation.frame = frame
  const head = animation.options.head
  let by = 0
  // Played from partway through, its first step lands there, whatever the `dt`, as `Playback.drive`'s does.
  const landing = animation.landing
  animation.landing = false
  if (!landing && !head.paused) by = tickOf(head, clamped, Machine.MAX_DT)
  animation.dt = by
  animation.time = Math.max(0, animation.time + by)
  writableOf(head).time = animation.time
  return by
}

/** Whether the key at `at` is held by a paused Playhead: it hands on no speed, as a held element's frames read 0 (#464). */
// Per key per change, while a driven change plays.
const heldAt = <S>(state: State<S>, at: number): boolean => {
  const driver = state.drivers[state.rules[at]]
  if (Predicate.isUndefined(driver)) return false
  return driver.options.head.paused
}

/**
 * The key at `at`'s value and speed at `time` into its change, from its start: a spring's by its closed
 * form, a tween's by its curve, keyframes' by their stops. Whether it has landed there.
 */
const valueAt = <S>(state: State<S>, at: number, rule: number, time: number): boolean => {
  const entry = state.entries[rule]
  if (entry.kind === KEYFRAMES) return keyframesAt(state, at, rule, time)
  const delay = state.delays[at]
  const goal = state.targets[at]
  const from = state.origins[at]
  const active = Math.max(0, time - delay)
  if (entry.kind === TWEEN) {
    const tween = entry.tween
    const landed = time >= delay + tween.duration
    const value = Scalar.lerp(from, goal, tween.ease(Scalar.clamp(active / tween.duration, 0, 1)))
    const before = Scalar.lerp(from, goal, tween.ease(Scalar.clamp(Math.max(0, active - FRAME) / tween.duration, 0, 1)))
    state.positions[at] = value
    state.velocities[at] = (value - before) / FRAME
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

/** It stops playing: its entries step at the frame's pace again, and the table may let them go. */
const finish = <S>(animation: AnimationState<S>): void => {
  if (!animation.playing) return
  animation.playing = false
  const { state } = animation
  state.animations.delete(animation)
  Arr.forEach(animation.held, (rule) => {
    state.drivers[rule] = undefined
    release(state, rule)
  })
}

/** Whether the key at `animation`'s `i`th is at rest at its target, past its delay. */
// Once a step, per key of a playing change: plain reads.
const keyAtRest = <S>(animation: AnimationState<S>, i: number): boolean => {
  const { state } = animation
  const at = animation.ats[i]
  return state.velocities[at] === 0 && state.positions[at] === animation.goals[i] && state.elapsed[at] >= state.delays[at]
}

/** The members `animation` moves nothing of, told they landed, once, at its first play (`onMemberLanded`). */
const tellIdle = <S>(animation: AnimationState<S>): void => {
  if (animation.idleTold) return
  animation.idleTold = true
  const tell = animation.options.onMemberLanded
  if (Predicate.isUndefined(tell)) return
  Arr.forEach(animation.idle, (slot) => tell(slot))
}

/**
 * Each member `animation` moves told, once, as every key of it it still moves has landed (`onMemberLanded`):
 * at its target, past its delay. One whose keys a later change took all is never told.
 */
// Once a step, per key of a playing change that tells its members: counted loops with plain reads.
const tellMembers = <S>(animation: AnimationState<S>, tell: (slot: number) => void): void => {
  const { state, firsts, told, ats } = animation
  const n = told.length
  for (let r = 0; r < n; r++) {
    if (told[r] === 1) continue
    let kept = false
    let atRest = true
    for (let i = firsts[r]; i < firsts[r + 1]; i++) {
      if (!holds(animation, i)) continue
      kept = true
      if (!keyAtRest(animation, i)) {
        atRest = false
        break
      }
    }
    if (!kept || !atRest) continue
    told[r] = 1
    tell(slotAt(state, ats[firsts[r]]))
  }
}

/**
 * Whether `animation` has landed, once a step while it plays: every key it still moves at its target,
 * past its delay; or, played backwards, back at its start. It ends then. A key a later change took keeps
 * it from landing (#433's latest-wins, as a ward's): it ends unheard, once the keys it kept are at rest.
 */
const checkLanding = <S>(animation: AnimationState<S>): void => {
  const { state, options } = animation
  const backwards = options.head.speed < 0
  const tell = options.onMemberLanded
  if (Predicate.isNotUndefined(tell) && !backwards) tellMembers(animation, tell)
  const count = animation.ats.length
  let atRest = true
  let held = 0
  // Once a step, per key of a playing change: a counted loop with plain reads.
  for (let i = 0; i < count; i++) {
    if (!holds(animation, i)) continue
    held++
    if (backwards) continue
    if (!keyAtRest(animation, i)) atRest = false
  }
  if (held > 0 && backwards && animation.time > 0) return
  if (!atRest) return
  // Played back to its start, each key it still moves rests there, its target with it: a later step of the
  // member, for a change of another key, leaves it there.
  if (backwards) {
    for (let i = 0; i < count; i++) {
      if (!holds(animation, i)) continue
      const at = animation.ats[i]
      state.targets[at] = state.origins[at]
    }
  }
  finish(animation)
  if (held < count) return
  UndefinedOr.map(options.onLanded, (told) => told())
}

/** A driven change's transition for a member's key, before its copy: its function's, or its own or `default`, else the key's own. */
const animationBagsOf = <S>(state: State<S>, given: RetargetOptions["transition"]): ((slot: number, k: number) => Transition) => {
  if (Predicate.isFunction(given)) return given
  // The Batch's own entries are transitions: `make`'s.
  const own = Arr.map(state.ownRules, (rule) => UndefinedOr.getOrThrow(state.bags[rule]) as Transition)
  if (Predicate.isUndefined(given)) return (_, k) => own[k]
  const bags = Arr.map(bagsOf(state, given), (bag, k) => UndefinedOr.match(bag, { onUndefined: () => own[k], onDefined: identity }))
  return (_, k) => bags[k]
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
export const animate: {
  (slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options: AnimateOptions): <S>(self: Batch<S>) => Animation
  <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options: AnimateOptions): Animation
} = dual(isBatch, <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options: AnimateOptions): Animation => {
  const state = stateOf(self)
  if (Predicate.isNotUndefined(options.delay)) checked(Delay, options.delay, "delay")
  const bagOf = animationBagsOf(state, options.transition)
  // A copy of each transition it runs, made once: most members' keys give the bag the last one gave.
  const copies = new Map<Transition, Transition>()
  let lastGiven: Transition | undefined = undefined
  let lastCopy: Transition | undefined = undefined
  const bag = (slot: number, k: number): Transition => {
    const given = bagOf(slot, k)
    if (given === lastGiven) return lastCopy as Transition
    let made = copies.get(given)
    if (Predicate.isUndefined(made)) {
      made = { ...given } as Transition
      copies.set(given, made)
    }
    lastGiven = given
    lastCopy = made
    return made
  }
  return animationFor(state, options, slots, { bag, targetOf, keyframesOf: undefined })
})

/** A driven change, unplayed: worked out at its first play, toward targets or through keyframes. */
const animationFor = <S>(
  state: State<S>,
  options: AnimateOptions,
  slots: ReadonlyArray<number>,
  moves: Pick<AnimationState<S>, "bag" | "targetOf" | "keyframesOf">,
): Animation => {
  const animation: AnimationState<S> = {
    state,
    options,
    slots,
    ...moves,
    ats: new Int32Array(0),
    starts: new Float64Array(0),
    speeds: new Float64Array(0),
    goals: new Float64Array(0),
    waits: new Float64Array(0),
    rules: new Uint16Array(0),
    held: [],
    started: false,
    playing: false,
    duration: undefined,
    time: 0,
    frame: 0,
    dt: 0,
    landing: false,
    tracks: [],
    indexAt: new Int32Array(0),
    firsts: new Int32Array(0),
    told: new Uint8Array(0),
    idle: [],
    idleTold: false,
  }
  return Object.assign(Object.create(AnimationProto), animation)
}

/** A `keyframes` change's transition for a key: never read, its tracks run its keys. */
const UNREAD_TRANSITION: Transition = { type: "tween" }
const NO_BAG = (): Transition => UNREAD_TRANSITION

/** A `keyframes` change's target for a key: never read, its tracks end its keys. */
const NO_TARGET = (): number => Number.NaN

/**
 * A change of `slots`' members through each key's own keyframes, `keyframesOf(slot, k)` (`undefined`
 * for a key it leaves), driven by `options.head`: each key as `Machine.keyframes` would run its stops,
 * frame for frame. Nothing moves until it's played; its controls are `animate`'s. A Sequence's Segment
 * of a Batch, its members' stops placed over the whole sequence, runs on it.
 *
 * @example
 * const head = Playback.make()
 * const wave = Batch.keyframes(grid, slots, (slot) => ({ stops: [Number.NaN, -20, 0], transition: { duration: 0.6, delay: slot * 0.05 } }), { head })
 * Batch.play(wave)
 */
// #665, Q36: one entry of its own, every key it moves on it, each key's track by its index.
export const keyframes: {
  (slots: ReadonlyArray<number>, keyframesOf: (slot: number, k: number) => Keyframes | undefined, options: KeyframesOptions): <S>(self: Batch<S>) => Animation
  <S>(self: Batch<S>, slots: ReadonlyArray<number>, keyframesOf: (slot: number, k: number) => Keyframes | undefined, options: KeyframesOptions): Animation
} = dual(isBatch, <S>(self: Batch<S>, slots: ReadonlyArray<number>, keyframesOf: (slot: number, k: number) => Keyframes | undefined, options: KeyframesOptions): Animation => {
  return animationFor(stateOf(self), options, slots, { bag: NO_BAG, targetOf: NO_TARGET, keyframesOf })
})

/** A key's keyframes resolved at its first play: its stops, each `NaN` the stop before, the first `current`; `undefined` for none. */
// Once a play, per key: statements.
const trackOf = (keyframes: Keyframes, current: number): Track | undefined => {
  const given = keyframes.stops
  if (given.length === 0) return undefined
  const resolved = resolveKeyframes(keyframes.transition)
  // One stop holds, as `Machine.keyframes`' does: it's there twice.
  const stops = new Float64Array(Math.max(2, given.length))
  let before = current
  for (let i = 0; i < given.length; i++) {
    let stop = given[i]
    if (Number.isNaN(stop)) stop = before
    stops[i] = stop
    before = stop
  }
  if (given.length === 1) stops[1] = stops[0]
  const run = resolved.run
  return {
    stops,
    stopTimes: stopTimesOf(stops.length, resolved.times, run.tween.duration),
    eases: resolved.eases,
    run,
    reverse: resolved.reverse,
    delay: resolved.delay,
    end: resolved.delay + run.total,
  }
}

/** {@link trackValue}'s pass, written in place: read right after, never across a call. */
// Module state (#460, Q7): per-frame scratch, written and read within one key's step, never across one.
const TRACK_PASS: Pass = { within: 0, reversed: false, flipped: false }

/** A track's value `time` seconds from its start, as `Machine.keyframes`' Frame then: its first stop through its delay. */
// Per frame, per key of a keyframes change: as `Machine.keyframes`' step, its delay held first (`Machine.delay`).
const trackValue = (track: Track, time: number): number => {
  passAt(Math.max(0, time - track.delay), track.run, track.reverse, TRACK_PASS)
  return keyframeAt(track.stops, track.stopTimes, track.eases, TRACK_PASS, track.run.tween.duration)
}

/** Where a track ends: its value at its end, or, for one that never ends, its last stop, which it never rests on. */
const trackGoal = (track: Track): number => {
  if (Number.isFinite(track.end)) return trackValue(track, track.end)
  return track.stops[track.stops.length - 1]
}

/** The key at `at`'s track, in the keyframes change driving its entry `rule`; `undefined` once that change has ended. */
const trackAt = <S>(state: State<S>, at: number, rule: number): Track | undefined => {
  const driver = state.drivers[rule]
  if (Predicate.isUndefined(driver)) return undefined
  return driver.tracks[driver.indexAt[at]]
}

/** The key at `at`'s keyframes `time` seconds in: its value, its speed over the frame before, and whether it has ended. */
// At a play and played backwards: out of line.
const keyframesAt = <S>(state: State<S>, at: number, rule: number, time: number): boolean => {
  const track = trackAt(state, at, rule)
  if (Predicate.isUndefined(track)) return true
  const value = trackValue(track, time)
  const before = trackValue(track, Math.max(0, time - FRAME))
  const landed = time >= track.end
  state.positions[at] = value
  state.velocities[at] = (value - before) / FRAME
  if (landed) state.velocities[at] = 0
  return landed
}

/**
 * A keyframes key's step to `time`, by `dt`, written in place: whether it has ended. Its speed is its
 * move over the step. One whose change has ended rests where it is, its target.
 */
// Per frame, per key of a keyframes change.
const stepKeyframes = <S>(state: State<S>, at: number, rule: number, time: number, dt: number): boolean => {
  const track = trackAt(state, at, rule)
  if (Predicate.isUndefined(track)) {
    state.positions[at] = state.targets[at]
    state.velocities[at] = 0
    return true
  }
  const next = trackValue(track, time)
  const landed = time >= track.end
  if (landed) state.velocities[at] = 0
  if (!landed && dt > 0) state.velocities[at] = (next - state.positions[at]) / dt
  state.positions[at] = next
  return landed
}

/** Its change worked out, once, at its first play: the keys it moves, where each starts, its target and its wait. */
const startOf = <S>(animation: AnimationState<S>): void => {
  if (Predicate.isNotUndefined(animation.keyframesOf)) return keyframesStartOf(animation, animation.keyframesOf)
  const { state, slots, targetOf, options } = animation
  const { stride, flags, positions, velocities, targets } = state
  const from = options.from
  const given = slots.length
  const most = given * stride
  const ats = new Int32Array(most)
  const starts = new Float64Array(most)
  const speeds = new Float64Array(most)
  const goals = new Float64Array(most)
  // Each mover's first key in `ats`, by rank, and one past the last mover's.
  const firsts = new Int32Array(given + 1)
  const driven = state.animations.size > 0
  let count = 0
  let n = 0
  const idle: Array<number> = []
  // Per member per key, once an animation, as a change's (ADR-0025, *Amendment (#665)*): counted loops
  // over its typed arrays. A slot given twice moves once.
  for (let g = 0; g < given; g++) {
    const slot = slots[g]
    const flag = flags[slot]
    if ((flag & LIVE) === 0) continue
    if ((flag & COUNTED) !== 0) continue
    const first = count
    for (let k = 0; k < stride; k++) {
      const at = slot * stride + k
      const target = targetOf(slot, k)
      if (Number.isNaN(target)) continue
      let start = positions[at]
      let speed = velocities[at]
      if (driven && heldAt(state, at)) speed = 0
      let jumps = false
      if (Predicate.isNotUndefined(from)) {
        const stop = from(slot, k)
        if (!Number.isNaN(stop)) {
          start = stop
          speed = 0
          jumps = true
        }
      }
      if (!jumps && target === targets[at]) continue
      ats[count] = at
      starts[count] = start
      speeds[count] = speed
      goals[count] = target
      count++
    }
    if (count === first) {
      // Counted too, so a slot given twice is idle once.
      flags[slot] = flag | COUNTED
      idle.push(slot)
      continue
    }
    flags[slot] = flag | COUNTED
    firsts[n] = first
    n++
  }
  firsts[n] = count
  // Each mover's keys wait by its rank among the movers.
  const delayOf = delayOfChange(options.delay)
  const waits = new Float64Array(count)
  for (let rank = 0; rank < n; rank++) {
    const slot = slotAt(state, ats[firsts[rank]])
    flags[slot] = flags[slot] & ~COUNTED
    const wait = delayOf(rank, n)
    for (let i = firsts[rank]; i < firsts[rank + 1]; i++) waits[i] = wait
  }
  animation.ats = ats.slice(0, count)
  animation.starts = starts.slice(0, count)
  animation.speeds = speeds.slice(0, count)
  animation.goals = goals.slice(0, count)
  animation.waits = waits
  animation.rules = new Uint16Array(count)
  animation.firsts = firsts.slice(0, n + 1)
  animation.told = new Uint8Array(n)
  for (let s = 0; s < idle.length; s++) flags[idle[s]] = flags[idle[s]] & ~COUNTED
  animation.idle = idle
  animation.started = true
}

/**
 * A keyframes change worked out, once, at its first play: each key it moves, its track, where it starts
 * and ends, and its end as its wait, so it lands no sooner.
 */
const keyframesStartOf = <S>(animation: AnimationState<S>, keyframesOf: (slot: number, k: number) => Keyframes | undefined): void => {
  const { state, slots } = animation
  const { stride, flags, positions } = state
  const given = slots.length
  const most = given * stride
  const ats = new Int32Array(most)
  const starts = new Float64Array(most)
  const goals = new Float64Array(most)
  const ends = new Float64Array(most)
  const counted = new Int32Array(given)
  const indexAt = new Int32Array(state.used * stride)
  const tracks: Array<Track> = []
  let count = 0
  let n = 0
  // Per member per key, once an animation, as a change's: counted loops. A slot given twice moves once.
  for (let g = 0; g < given; g++) {
    const slot = slots[g]
    const flag = flags[slot]
    if ((flag & LIVE) === 0) continue
    if ((flag & COUNTED) !== 0) continue
    flags[slot] = flag | COUNTED
    counted[n] = slot
    n++
    for (let k = 0; k < stride; k++) {
      const at = slot * stride + k
      const keyframes = keyframesOf(slot, k)
      if (Predicate.isUndefined(keyframes)) continue
      const track = trackOf(keyframes, positions[at])
      if (Predicate.isUndefined(track)) continue
      ats[count] = at
      starts[count] = trackValue(track, 0)
      goals[count] = trackGoal(track)
      ends[count] = track.end
      indexAt[at] = count
      tracks.push(track)
      count++
    }
  }
  for (let c = 0; c < n; c++) flags[counted[c]] = flags[counted[c]] & ~COUNTED
  animation.ats = ats.slice(0, count)
  animation.starts = starts.slice(0, count)
  animation.speeds = new Float64Array(count)
  animation.goals = goals.slice(0, count)
  animation.waits = ends.slice(0, count)
  animation.rules = new Uint16Array(count)
  animation.tracks = tracks
  animation.indexAt = indexAt
  animation.started = true
}

/** A keyframes change's entry: every key it moves is on it, its own, so its Playhead reaches them alone. */
const KEYFRAMES_ENTRY: Entry = { kind: KEYFRAMES, delay: 0, spring: NO_SPRING, tween: NO_TWEEN }

/** `animation`'s rule for each key it moves: its own keyframes entry, or each key's transition's. */
// Once a play, per key it moves.
const playRules = <S>(animation: AnimationState<S>): void => {
  const { state } = animation
  const count = animation.ats.length
  if (Predicate.isNotUndefined(animation.keyframesOf)) {
    let rule = state.ruleByBag.get(animation)
    if (Predicate.isUndefined(rule)) rule = entryRuleOf(state, animation, KEYFRAMES_ENTRY)
    animation.rules.fill(rule)
    return
  }
  for (let i = 0; i < count; i++) {
    const at = animation.ats[i]
    const slot = slotAt(state, at)
    animation.rules[i] = ruleFor(state, animation.bag(slot, at - slot * state.stride))
  }
}

/**
 * Plays `animation` from its Playhead's time: from its start at 0, its change worked out then, and from
 * wherever a seek put the time, every key it moves taken again there. It returns how many members it
 * sets off from rest. One that moves nothing lands at once, as an element's call with no key does.
 */
export const play = (self: Animation): number => {
  const animation = animationOf(self)
  const { state, options } = animation
  if (!animation.started) startOf(animation)
  finish(animation)
  tellIdle(animation)
  const count = animation.ats.length
  if (count === 0) {
    UndefinedOr.map(options.onLanded, (told) => told())
    return 0
  }
  const time = options.head.time
  animation.playing = true
  animation.time = time
  animation.landing = time > 0
  state.animations.add(animation)
  // Once a play, per key it moves: each key's entry, then each entry held once for it and driven by it.
  playRules(animation)
  animation.held = Arr.dedupe(Arr.fromIterable(animation.rules))
  Arr.forEach(animation.held, (rule) => {
    hold(state, rule)
    state.drivers[rule] = animation
  })
  let setOff = 0
  for (let i = 0; i < count; i++) {
    const at = animation.ats[i]
    const rule = animation.rules[i]
    turn(state, at, rule, animation.goals[i], animation.starts[i], animation.speeds[i], animation.waits[i])
    state.elapsed[at] = time
    valueAt(state, at, rule, time)
    setOff += moving(state, slotAt(state, at))
  }
  return setOff
}

/** The member at `slot` moving in the ruled list, so the next step draws it and rests it: 1 when that sets it off from rest. */
const moving = <S>(state: State<S>, slot: number): number => {
  const flag = state.flags[slot]
  if ((flag & IN_RULED) !== 0) return 0
  state.flags[slot] = (flag & ~IN_PLAIN) | IN_RULED
  state.ruledList[state.ruledCount] = slot
  state.ruledCount = state.ruledCount + 1
  if ((flag & IN_PLAIN) !== 0) return 0
  return 1
}

/** The key at `at` put at rest at `value`, drawn there at the next step and resting there, a tween's too. */
const restAt = <S>(state: State<S>, at: number, value: number): void => {
  state.positions[at] = value
  state.targets[at] = value
  state.origins[at] = value
  state.velocities[at] = 0
  // Past any delay and duration: its next step lands it where it is.
  state.elapsed[at] = Number.POSITIVE_INFINITY
  moving(state, slotAt(state, at))
}

/** Ends `animation` where it is: the keys it moves stay there, at rest. */
export const stop = (self: Animation): void => {
  const animation = animationOf(self)
  if (!animation.playing) return
  const { state } = animation
  // Once a stop, per key it moves: one a later change took stays that change's.
  for (let i = 0; i < animation.ats.length; i++) {
    if (!holds(animation, i)) continue
    const at = animation.ats[i]
    restAt(state, at, state.positions[at])
  }
  finish(animation)
}

/** Ends `animation`, and puts the keys it moved back where it started them, at rest. */
export const cancel = (self: Animation): void => {
  const animation = animationOf(self)
  const { state } = animation
  // Once a cancel, per key it moved: one a later change took stays that change's.
  for (let i = 0; i < animation.ats.length; i++) {
    if (state.targets[animation.ats[i]] !== animation.goals[i]) continue
    restAt(state, animation.ats[i], animation.starts[i])
  }
  finish(animation)
}

/**
 * How long a key runs, stepped at 60 Hz: the frames until its time, summed as its steps sum it, less
 * `after`, reaches `seconds`. A tween or keyframes ends at its end from its start, as `Machine.durationOf`
 * steps one; a spring set by its duration, its duration past its delay, as its step reads it. `Infinity`
 * for one not done by `Machine.MAX_DURATION`.
 */
// 105 frames sum to 1.7499999999999987: a key ending at 1.75 lands at the 106th, where rounding to frames said 105.
const framesUntil = (seconds: number, after = 0): number => {
  const most = Math.ceil(Machine.MAX_DURATION / FRAME)
  let time = 0
  // Once a duration, per distinct end: a counted loop.
  for (let f = 0; f <= most; f++) {
    if (time - after >= seconds) return f * FRAME
    time += FRAME
  }
  return Number.POSITIVE_INFINITY
}

/**
 * How long `animation` runs, in seconds: its longest key's, a spring's until it rests, stepped from its
 * start at 60 Hz as `Machine.durationOf` steps a machine. Worked out once.
 */
// Stepped here, not through `Machine.durationOf`, which would build a machine for each member's key.
export const durationOf = (self: Animation): number => {
  const animation = animationOf(self)
  if (Predicate.isNotUndefined(animation.duration)) return animation.duration
  const { state } = animation
  if (!animation.started) startOf(animation)
  const most = Math.ceil(Machine.MAX_DURATION / FRAME)
  let longest = 0
  // Keyframes: each key's end, its wait; a sequence's keys share theirs.
  if (Predicate.isNotUndefined(animation.keyframesOf)) {
    const known = new Map<number, number>()
    for (let i = 0; i < animation.waits.length; i++) {
      const end = animation.waits[i]
      let seconds = known.get(end)
      if (Predicate.isUndefined(seconds)) {
        seconds = framesUntil(end)
        known.set(end, seconds)
      }
      longest = Math.max(longest, seconds)
    }
    animation.duration = longest
    return longest
  }
  // Once an animation, per key: a counted loop to its rest.
  for (let i = 0; i < animation.ats.length; i++) {
    const at = animation.ats[i]
    const slot = slotAt(state, at)
    const entry = entryFor(animation.bag(slot, at - slot * state.stride))
    const delay = entry.delay + animation.waits[i]
    const goal = animation.goals[i]
    const distance = goal - animation.starts[i]
    if (entry.kind === TWEEN) {
      longest = Math.max(longest, framesUntil(delay + entry.tween.duration))
      continue
    }
    if (entry.kind === TIMED) {
      longest = Math.max(longest, framesUntil(entry.spring.duration, delay))
      continue
    }
    const restDelta = Spring.restDeltaFor(entry.spring, distance)
    const restSpeed = Spring.restSpeedFor(entry.spring, distance)
    let position = animation.starts[i]
    let speed = animation.speeds[i]
    let time = 0
    let steps = most
    for (let f = 1; f <= most; f++) {
      time += FRAME
      const simDt = Math.max(0, Math.min(FRAME, time - delay))
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
    longest = Math.max(longest, steps * FRAME)
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
  const at = slot * state.stride + keyAt(state, key)
  // Held by a paused Playhead, it reads 0 (#464).
  if (state.animations.size > 0 && heldAt(state, at)) return 0
  return state.velocities[at]
}
