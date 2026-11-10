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
 * const slots = tiles.map((tile) => Batch.enter(grid, tile, { x: 0, y: 0 }))
 * Batch.retarget(grid, slots, (slot, k) => cellOf(slot)[k])
 */
// #665, ADR-0069 decisions 10–18 and *Amendment (#665)*. Tier 2 (ADR-0008): for binding and Environment
// authors; an app reaches a Batch through its binding's `createBatch`. State by index in typed arrays,
// a member's keys at `slot * stride + k` (#663's shape); stepped by `Spring.matrixFor`'s exact step
// (#370), the probe's loop (`.tmp/564-canvas/perf/group.ts` on `probe/564-canvas`).
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import type { Invariant } from "effect/Types"
import * as Inspectable from "effect/Inspectable"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Frame from "./Frame.ts"
import type * as FrameLoop from "./FrameLoop.ts"
import * as Machine from "./Machine.ts"
import * as Scalar from "./Scalar.ts"
import * as Spring from "./Spring.ts"
import type { ResolvedTween } from "./internal/stepper.ts"
import { dual } from "./internal/dual.ts"

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
  /** Called once a frame, after every member's write: an InstancedMesh's `needsUpdate`. */
  readonly flush?: () => void
}

/** A transition a Batch runs a key with: a spring, or a tween. */
export type Transition =
  | ({ readonly type: "spring" } & Omit<Machine.SpringOptions, "from" | "velocity">)
  | ({ readonly type: "tween" } & Machine.TweenOptions)

/** `retarget`'s options. */
export interface RetargetOptions {
  /**
   * How this change's keys move: one transition for every key, or one per key by its name. A key it
   * doesn't give moves by the Batch's own.
   */
  readonly transition?: Transition | Readonly<Record<string, Transition>>
  /**
   * Seconds each member waits before it moves, after its transition's own delay: one for all, or by
   * its rank among the members this change moves, of `n`, as `Stagger.make`'s delays are.
   */
  // ADR-0069, *Amendment (#665)*: the movers, as Motion's `animate(elements)` counts what it's given.
  readonly delay?: number | ((rank: number, n: number) => number)
}

/** Whether a change's `transition` is one transition, not one per key. */
const isTransition = (u: Transition | Readonly<Record<string, Transition>>): u is Transition => Predicate.hasProperty(u, "type")

/** A transition in a Batch's table, resolved once: a spring's physics, or a tween's curve. */
// ADR-0069, *Amendment (#665)*: each member's key records which entry it runs.
interface Entry {
  /** 0 a spring, 1 a tween, 2 a spring that ends at its `duration` (#359). */
  readonly kind: 0 | 1 | 2
  readonly delay: number
  readonly spring: Spring.Resolved
  readonly tween: ResolvedTween
}

/** `make`'s options. */
export interface Options<S> {
  /** The keys its members animate, fixed when it's made. */
  readonly keys: ReadonlyArray<string>
  /** How its members are drawn. */
  readonly writer: Writer<S>
  /** How its keys move, unless a change gives its own. */
  readonly transition: Transition
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

/** A Batch's state, which only this module's operations write. */
interface State<S> {
  readonly keys: ReadonlyArray<string>
  readonly stride: number
  capacity: number
  /** How many slots have ever been entered: every slot below is a member's. */
  used: number
  subjects: Array<S | undefined>
  positions: Float64Array
  velocities: Float64Array
  targets: Float64Array
  elapsed: Float64Array
  delays: Float64Array
  restDeltas: Float64Array
  restSpeeds: Float64Array
  /** Where each member's key started its tween. */
  origins: Float64Array
  /** Which of `entries` each member's key runs. */
  rules: Uint16Array
  /** The transitions its members run, the Batch's own first. */
  readonly entries: Array<Entry>
  /** Each entry's kind by its index, read per key in place of the entry: `Entry`'s `kind`. */
  kinds: Uint8Array
  /** Each spring entry's step matrix for this frame's `dt`, four numbers an entry: worked out once a frame. */
  matrices: Float64Array

  /** Each transition's index in `entries`, by the bag it was given as. */
  readonly entryOf: Map<Transition, number>
  /** The Batch's own transition, as it was given: `entries`' first. */
  readonly own: Transition
  /** A change's new targets, `NaN` for a key it keeps: its first pass's, read by its second. */
  pending: Float64Array
  /** A change's members that move, in order: its first pass's. */
  movers: Int32Array
  /** The slots a `leave` freed, the next `enter`'s. */
  readonly free: Array<number>
  /**
   * Per slot, `LIVE` while a member holds it (from its `enter` to its `leave`), and `IN_LIST` or
   * `IN_TABLE` while it moves. A member another transition takes moves to `table` and stays until it
   * rests; `list` drops it at its next step. One byte, so each step reads one per member.
   */
  flags: Uint8Array
  /** The members moving with every key on the Batch's own spring, `count` of them: stepped by one matrix. */
  list: Int32Array
  count: number
  /**
   * The members moving with a key on another transition, `tableCount` of them: stepped by each key's
   * rule. Members that share the Batch's own spring step as if there were no table.
   */
  // ADR-0069, *Amendment (#665)*: read per key for every member, the table cost a step 13–16% (Bun,
  // Node; 10,000 members).
  table: Int32Array
  tableCount: number
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
    return { _id: "Batch", keys: this.keys, members: this.used, moving: this.count + this.tableCount, transitions: this.entries.length }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/** Whether `u` is a Batch. */
export const isBatch = (u: unknown): u is Batch<unknown> => Predicate.hasProperty(u, TypeId)

/** A slot's flags: a member holds it; it moves in `list`; it moves in `table`. */
const LIVE = 1
const IN_LIST = 2
const IN_TABLE = 4

const stateOf = <S>(batch: Batch<S>): State<S> => batch as unknown as State<S>

const noop = (): void => {}

/** No spring: a tween's entry's. */
const NO_SPRING: Spring.Resolved = Spring.resolve({})

/** No tween: a spring's entry's. */
const NO_TWEEN: ResolvedTween = Machine.resolveTween({})

/** The transitions a Batch runs. */
const RUN_TYPES: ReadonlyArray<unknown> = ["spring", "tween"]

/** Whether a transition's `type` is one a Batch runs. */
const isRunType = (type: unknown): boolean => RUN_TYPES.includes(type)

/** `transition`, resolved for the table: its bag checked once (`Spring.resolve`, `resolveTween`). */
// A Batch runs springs and tweens alone (ADR-0069, decision 11): no keyframes, inertia or decay.
const entryFor = (transition: Transition): Entry => {
  const type: unknown = transition.type
  if (!isRunType(type)) {
    throw new Machine.OptionError({ message: `Expected "spring" | "tween", got ${JSON.stringify(type)}\n  at ["transition"]["type"]` })
  }
  if (transition.type === "tween") {
    const tween = Machine.resolveTween(transition)
    return { kind: 1, delay: tween.delay, spring: NO_SPRING, tween }
  }
  const spring = Spring.resolve(transition)
  if (Spring.endsOnTime(spring)) return { kind: 2, delay: spring.delay, spring, tween: NO_TWEEN }
  return { kind: 0, delay: spring.delay, spring, tween: NO_TWEEN }
}

/** `transition`'s index in `state`'s table, added at its first use. */
const ruleOf = <S>(state: State<S>, transition: Transition): number =>
  UndefinedOr.match(state.entryOf.get(transition), {
    onDefined: identity,
    onUndefined: () => {
      const index = state.entries.length
      const entry = entryFor(transition)
      state.entries.push(entry)
      state.entryOf.set(transition, index)
      if (index === state.kinds.length) {
        state.kinds = grown(state.kinds, index * 2)
        state.matrices = grown(state.matrices, index * 2 * 4)
      }
      state.kinds[index] = entry.kind
      return index
    },
  })

/**
 * A Batch of no members yet, on `options.keys`, drawn by `options.writer`.
 *
 * @example
 * const grid = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
 */
export const make = <S>(options: Options<S>): Batch<S> => {
  options.keys.forEach((key, k) => {
    if (options.writer.writes(key)) return
    throw new Machine.OptionError({ message: `Expected a key its writer draws, got ${JSON.stringify(key)}\n  at ["keys"][${k}]` })
  })
  const capacity = UndefinedOr.match(options.capacity, { onUndefined: () => 16, onDefined: (n) => Math.max(1, Math.ceil(n)) })
  const own = entryFor(options.transition)
  const stride = options.keys.length
  const size = capacity * stride
  const state: State<S> = {
    keys: options.keys,
    stride,
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
    free: [],
    entries: [own],
    kinds: Uint8Array.of(own.kind, 0, 0, 0, 0, 0, 0, 0),
    matrices: new Float64Array(8 * 4),
    table: new Int32Array(capacity),
    tableCount: 0,
    entryOf: new Map([[options.transition, 0]]),
    own: options.transition,
    flags: new Uint8Array(capacity),
    list: new Int32Array(capacity),
    count: 0,
    write: options.writer.forKeys(options.keys),
    flush: UndefinedOr.match(options.writer.flush, { onUndefined: () => noop, onDefined: identity }),
    onFrame: UndefinedOr.match(options.onFrame, { onUndefined: () => noop, onDefined: identity }),
    running: 0,
    runs: 0,
  }
  return Object.assign(Object.create(Proto), state)
}

/** No delay: a change's that gives none. */
const NO_DELAY = (): number => 0

/** A change's delay as a function of a mover's rank and how many move: once a change. */
const delayOfChange = (delay: RetargetOptions["delay"]): ((rank: number, n: number) => number) => {
  if (Predicate.isUndefined(delay)) return NO_DELAY
  if (Predicate.isNumber(delay)) return () => delay
  return delay
}

/** A change's rule for each of `state`'s keys, by index: once a change. */
const rulesOf = <S>(state: State<S>, transition: RetargetOptions["transition"]): ReadonlyArray<number> => {
  if (Predicate.isUndefined(transition)) return Arr.map(state.keys, () => 0)
  if (isTransition(transition)) {
    const rule = ruleOf(state, transition)
    return Arr.map(state.keys, () => rule)
  }
  return Arr.map(state.keys, (key) =>
    UndefinedOr.match(transition[key], { onUndefined: () => 0, onDefined: (given) => ruleOf(state, given) }))
}

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
  state.keys.forEach((key, k) => {
    const value = UndefinedOr.match(start[key], { onUndefined: () => 0, onDefined: identity })
    const at = base + k
    state.positions[at] = value
    state.targets[at] = value
    state.velocities[at] = 0
    // A reused slot keeps nothing of the member before: at rest on its start, on the Batch's own transition.
    state.elapsed[at] = 0
    state.delays[at] = 0
    state.rules[at] = 0
  })
  return slot
})

/**
 * The member at `slot` leaves: it isn't written again, and its slot goes to the next to enter.
 *
 * @example
 * Batch.leave(grid, slot)
 */
// Its slot stays in the moving list until the next step drops it: no search per leave.
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
const grown = <A extends Float64Array | Int32Array | Uint8Array | Uint16Array>(from: A, size: number): A => {
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
  state.list = grown(state.list, capacity)
  state.table = grown(state.table, capacity)
}

/**
 * One change: each of `slots`' members turned toward `targetOf(slot, k)` for its `k`th key (`NaN`
 * keeps that key's target). A member whose targets are unchanged gets nothing.
 *
 * @example
 * Batch.retarget(grid, slots, (slot, k) => cellOf(slot)[k])
 */
export const retarget: {
  (slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options?: RetargetOptions): <S>(self: Batch<S>) => void
  <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options?: RetargetOptions): void
} = dual(isBatch, <S>(self: Batch<S>, slots: ReadonlyArray<number>, targetOf: (slot: number, k: number) => number, options?: RetargetOptions): void => {
  const state = stateOf(self)
  const { stride, pending, movers, targets } = state
  const rules = rulesOf(state, UndefinedOr.map(options, (given) => given.transition))
  const delayOf = delayOfChange(UndefinedOr.map(options, (given) => given.delay))
  // Per member per key at a change, the Batch's own hot loop (ADR-0069, *Amendment (#665)*): counted
  // loops over its typed arrays. The first pass keeps each new target and finds the members that
  // move, so the second can count them for their delays.
  let n = 0
  slots.forEach((slot) => {
    // A member that left takes no change.
    if ((state.flags[slot] & LIVE) === 0) return
    const base = slot * stride
    let moves = false
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const target = targetOf(slot, k)
      pending[at] = target
      if (!Number.isNaN(target) && target !== targets[at]) moves = true
    }
    if (!moves) return
    movers[n] = slot
    n++
  })
  for (let rank = 0; rank < n; rank++) {
    const slot = movers[rank]
    const base = slot * stride
    const wait = delayOf(rank, n)
    // Whether a key it turns runs a transition other than the Batch's own spring.
    let ruled = false
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const target = pending[at]
      if (Number.isNaN(target)) continue
      if (target === targets[at]) continue
      const rule = rules[k]
      const entry = state.entries[rule]
      if (rule !== 0 || entry.kind !== 0) ruled = true
      targets[at] = target
      state.origins[at] = state.positions[at]
      state.rules[at] = rule
      state.elapsed[at] = 0
      state.delays[at] = entry.delay + wait
      const distance = target - state.positions[at]
      state.restDeltas[at] = Spring.restDeltaFor(entry.spring, distance)
      state.restSpeeds[at] = Spring.restSpeedFor(entry.spring, distance)
      // A spring that ends at its duration starts from rest, as Motion's, and rests by no threshold:
      // it lands at its duration (#359), as `springValues`' does.
      if (entry.kind === 2) {
        state.velocities[at] = 0
        state.restDeltas[at] = -1
        state.restSpeeds[at] = -1
      }
    }
    const flags = state.flags[slot]
    // Into the table, out of the list (which drops it at its next step); else into the list, if it's in neither.
    if (ruled && (flags & IN_TABLE) === 0) {
      state.flags[slot] = (flags & ~IN_LIST) | IN_TABLE
      state.table[state.tableCount] = slot
      state.tableCount = state.tableCount + 1
    }
    if (!ruled && (flags & (IN_LIST | IN_TABLE)) === 0) {
      state.flags[slot] = flags | IN_LIST
      state.list[state.count] = slot
      state.count = state.count + 1
    }
  }
})

/**
 * Steps every moving member by `dt` seconds and writes each one: whether nothing moves now. The run
 * on the Frame loop calls it each tick.
 */
// Per frame (ADR-0025, ADR-0030 decisions 10 and 11): `dt` clamped once (#78), then one of two loops.
// Each steps a key by `springValues`' exact step, or `Machine.tween`'s, its spring's matrix worked out
// once a frame: called per key, `matrixFor` cost the step 2.5× (#665).
export const step = <S>(self: Batch<S>, dt: number): boolean => {
  const state = stateOf(self)
  const clamped = Math.min(dt, Machine.MAX_DT)
  if (state.count > 0) stepOne(state, clamped)
  if (state.tableCount > 0) stepTable(state, clamped)
  state.flush()
  state.onFrame()
  // Counted after `onFrame`: a change it makes keeps the run going.
  if (state.count + state.tableCount > 0) return false
  if (state.entries.length > 1) forgetTransitions(state)
  return true
}

/**
 * At rest, every transition but the Batch's own is forgotten: no member moves, so no rule is read
 * until a change sets it again. A bag a caller makes for each change doesn't pile up.
 */
// Once a rest, over every member's key (#665).
const forgetTransitions = <S>(state: State<S>): void => {
  state.entries.length = 1
  state.entryOf.clear()
  state.entryOf.set(state.own, 0)
  state.rules.fill(0)
}

/** The members in `list`, every key on the Batch's own spring, by one matrix. */
// Per frame. The table's loop below, less its read of each key's rule and kind (#665).
const stepOne = <S>(state: State<S>, clamped: number): void => {
  const { stride, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, list, flags, subjects, write } = state
  const spring = state.entries[0].spring
  const m = Spring.matrixFor(spring, clamped)
  const dd = m.dd
  const dv = m.dv
  const vd = m.vd
  const vv = m.vv
  const count = state.count
  let kept = 0
  for (let a = 0; a < count; a++) {
    const slot = list[a]
    const flag = flags[slot]
    // A member another transition took is the table's now; one that left is dropped here, unwritten.
    if (flag !== (LIVE | IN_LIST)) {
      if ((flag & IN_LIST) !== 0) flags[slot] = flag & ~IN_LIST
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
    list[kept] = slot
    kept++
  }
  state.count = kept
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

/** Every moving member's keys, each by the transition its rule names: a spring's matrix, or a tween. */
// Per frame. Each spring entry's matrix for this `dt`, once, then plain reads by rule (#665).
const stepTable = <S>(state: State<S>, clamped: number): void => {
  const { stride, entries, kinds, matrices, rules, positions, velocities, targets, elapsed, delays, restDeltas, restSpeeds, table, flags, subjects, write } = state
  for (let e = 0; e < entries.length; e++) {
    // Every spring entry, timed ones too: a tween has no matrix.
    if (kinds[e] === 1) continue
    const m = Spring.matrixFor(entries[e].spring, clamped)
    matrices[e * 4] = m.dd
    matrices[e * 4 + 1] = m.dv
    matrices[e * 4 + 2] = m.vd
    matrices[e * 4 + 3] = m.vv
  }
  const count = state.tableCount
  let kept = 0
  for (let a = 0; a < count; a++) {
    const slot = table[a]
    const flag = flags[slot]
    // A member that left is dropped here, unwritten.
    if ((flag & LIVE) === 0) {
      flags[slot] = flag & ~IN_TABLE
      continue
    }
    const base = slot * stride
    let still = true
    for (let k = 0; k < stride; k++) {
      const at = base + k
      const rule = rules[at]
      const goal = targets[at]
      const time = elapsed[at] + clamped
      const delay = delays[at]
      let position = positions[at]
      let speed = velocities[at]
      let settled = false
      // A tween, as `Machine.tween`'s, out of line: eased from where it started, its speed from its last frame.
      if (kinds[rule] === 1) {
        settled = stepTween(state, at, entries[rule].tween, time, clamped)
        if (!settled) still = false
        elapsed[at] = time
        continue
      }
      // A spring, as `springValues`': only the part of this tick past the delay moves it.
      const simDt = Math.max(0, Math.min(clamped, time - delay))
      if (simDt === clamped) {
        const mi = rule * 4
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
      settled = simDt > 0 && Math.abs(speed) <= restSpeeds[at] && Math.abs(position - goal) <= restDeltas[at]
      // A spring that ends at its duration lands there (#359).
      if (kinds[rule] === 2 && time - delay >= entries[rule].spring.duration) settled = true
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
    // At rest: still its member's, in neither list (a member is in one at most).
    if (still) {
      flags[slot] = LIVE
      continue
    }
    table[kept] = slot
    kept++
  }
  state.tableCount = kept
}

/** A sink that keeps nothing: a Batch's run writes as it steps. */
const ignore = (): undefined => undefined

/** The run numbered `id`: a step of the Batch each tick, until nothing moves. */
const machineOf = <S>(self: Batch<S>, state: State<S>, id: number): Machine.Machine<Frame.Frame<number>> =>
  Machine.make({
    settles: true,
    span: { name: "wardic.batch", attributes: { keys: state.stride } },
    start: () => {
      const frame = { value: 0, done: false }
      // Per frame (ADR-0025): the step, and its count of members moving.
      return (dt) => {
        const done = step(self, dt)
        frame.value = state.count + state.tableCount
        if (!done) return frame
        frame.done = true
        // Marked ended in the step that rests, so a change later in the same tick starts the next run.
        if (state.running === id) state.running = 0
        return frame
      }
    },
  })

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
    if (state.count + state.tableCount === 0) return Effect.void
    const id = state.runs + 1
    state.runs = id
    state.running = id
    return Effect.ensuring(
      Effect.asVoid(Machine.run(machineOf(self, state, id), ignore)),
      Effect.sync(() => {
        if (state.running === id) state.running = 0
      }),
    )
  })

/** A member's value for `key` now. */
// Per frame: a sink may read it for every member.
export const get = <S>(self: Batch<S>, slot: number, key: string): number => {
  const state = stateOf(self)
  return state.positions[slot * state.stride + state.keys.indexOf(key)]
}

/** A member's velocity for `key` now, per second: what an animation that takes the key over starts with. */
// Per frame, as `get`.
export const velocity = <S>(self: Batch<S>, slot: number, key: string): number => {
  const state = stateOf(self)
  return state.velocities[slot * state.stride + state.keys.indexOf(key)]
}
