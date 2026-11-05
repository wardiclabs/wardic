/**
 * Animation sequences, as Motion's: a timeline of Segments, compiled to one keyframes animation per
 * subject and key, each stop placed in time over the whole sequence. A binding resolves each Segment's
 * subjects and transitions, compiles once, and runs what comes back on its own animations.
 *
 * - **Segments follow one another:** each starts where the one before ended, unless its `at` says
 *   where. A **label** names a time a later Segment's `at` can give.
 * - **A key's transition places its stops in its Segment:** its `duration`, its `delay` (a function
 *   of each subject's index and count, when it's one), its `times` and an `ease` per stretch. A
 *   `repeat` below 20 is unrolled into stops. A spring through two stops or fewer becomes an easing
 *   over the time it takes to rest, so a sequence is tweens all through.
 * - **A key's stops** are its Segments' in time order, a later Segment's replacing the stops it
 *   overlaps. A Segment's single value starts from a `null`, the stop before it.
 *
 * @example
 * import * as Sequence from "@wardic/core/Sequence"
 *
 * const animations = Sequence.compile([
 *   { subjects: [card], target: { x: 100 }, transitions: { x: { type: "tween", duration: 1 } } },
 *   "landed",
 *   { subjects: [badge], target: { opacity: 1 }, transitions: {}, at: "landed" },
 * ])
 * animations.get(card) // { keyframes: { x: [null, 100] }, transition: { x: { … } } }
 */
// #433, CONTEXT.md **Sequence**: Motion's `createAnimationsFromSequence` (framer-motion/src/animation/
// sequence/create.ts at 16c6122). "reverse" and "mirror" repeats turn every other pass; a spring is
// sampled as Motion's `createGeneratorEasing`; a first stop after the start is held from 0, and the last
// held to the end with a `null`. Pure and cold. Tier 2 (ADR-0008): for binding authors.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as DefaultTransition from "./DefaultTransition.ts"
import * as Easing from "./Easing.ts"
import * as Machine from "./Machine.ts"
import * as Scalar from "./Scalar.ts"

/** One of a key's stops: a value, or `null`, the stop before it (the key's value now, first). */
export type Stop = number | string | null

/**
 * Where a Segment starts, or a label's time (Motion's `SequenceTime`): seconds into the sequence;
 * `"+0.5"` / `"-0.5"` after or before the end of the Segment before; `"<"` at that Segment's start,
 * `"<+0.5"` / `"<-0.5"` around it; or a label's name, its time (an unknown one, the end of the
 * Segment before). Never before 0.
 */
export type Time = number | string

/** A label with its own time (Motion's `SequenceLabelWithTime`): `{ name: "fade", at: "-0.2" }`. */
export interface Label {
  readonly name: string
  readonly at: Time
}

/** A Segment's delay (Motion's): seconds, or each subject's, by its index in the Segment and their count. */
export type Delay = number | ((index: number, count: number) => number)

/** The `delay` a key's transition in a Segment takes, each subject's when it's a function. */
interface Placing {
  readonly delay?: Delay | undefined
}

/**
 * One key's transition in a Segment: a spring or a tween, as the binding resolves the Segment's own
 * for the key, with its `delay`, `times` and repeat. A spring through two stops or fewer is sampled
 * into an easing; through more it runs as a tween of its `duration` (0.3 s), as Motion's.
 */
export type Transition =
  | ({ readonly type: "spring" } & Omit<Machine.SpringOptions, "delay" | "from"> & Omit<Machine.KeyframesOptions, "delay" | "duration" | "ease"> & Placing)
  | ({ readonly type: "tween" } & Omit<Machine.KeyframesOptions, "delay"> & Placing)

/**
 * A Segment (Motion's `[subject, keyframes, transition]`): its subjects, each key's value or stops,
 * each key's transition (a key without one runs on a 0.3 s `easeOut` tween), and where it starts.
 */
export interface Segment<S> {
  /** What it animates: elements, or anything a binding animates, such as a callback's value. */
  readonly subjects: ReadonlyArray<S>
  /** Each key's value, or its stops. */
  readonly target: Readonly<Record<string, Stop | ReadonlyArray<Stop>>>
  /** Each key's transition, as the binding resolved it; a key with none runs on a 0.3 s `easeOut` tween. */
  readonly transitions: Readonly<Record<string, Transition>>
  /** Where it starts: after the Segment before, when left out. */
  readonly at?: Time | undefined
}

/** A sequence's step: a label at the end of the Segment before, a label with its own time, or a Segment. */
export type Step<S> = string | Label | Segment<S>

/**
 * A whole sequence's options (Motion's `SequenceOptions`), laid over each key's animation: its
 * `duration` (the timeline scaled to it), `delay`, and `repeat`, `repeatType` and `repeatDelay`.
 */
export type Options = { readonly [K in "duration" | "delay" | "repeat" | "repeatType" | "repeatDelay"]?: Machine.KeyframesOptions[K] | undefined }

/** A subject's animation: each key's stops, and the tween it runs them on, its `times` over the whole sequence. */
export interface Animation {
  /** Each key's stops over the whole sequence. */
  readonly keyframes: Readonly<Record<string, ReadonlyArray<Stop>>>
  /** Each key's tween through them: its `duration` the sequence's, its `times` placing each stop. */
  readonly transition: Readonly<Record<string, DefaultTransition.KeyframesTransition>>
}

/** No options. */
const NO_OPTIONS: Options = {}

/** A Segment's default tween (Motion's): 0.3 s, `easeOut`. */
const TWEEN: Transition = { type: "tween" }

/** A Segment's duration with none given (Motion's `defaultDuration`). */
const DEFAULT_DURATION = 0.3

/** A Segment's easing with none given (Motion's). */
const DEFAULT_EASE: Easing.Definition = "easeOut"

/** The easing from 0 to a first stop placed after it, which holds (Motion's `defaultSegmentEasing`). */
const HOLD_EASE: Easing.Definition = "easeInOut"

/** The easing into a repeat's first stop, and through its delay (Motion's). */
const LINEAR: Easing.Definition = "linear"

/** A Segment's `repeat` at or above this is left out, as Motion's (`MAX_REPEAT`): the stops would explode. */
export const MAX_REPEAT = 20

/** The steps a second a spring is sampled at into an easing: `Easing.spring`'s. */
const SAMPLES_PER_SECOND = 240

/** A spring's move when its two stops aren't both numbers, or don't move (Motion's 0–100). */
const UNKNOWN_MOVE = 100

/** A stop at its time in the sequence, with the easing toward the stop after it. */
interface Placed {
  readonly value: Stop
  readonly at: number
  readonly ease: Easing.Definition
}

/** A key's stops in one Segment: their places from 0 to 1 within it, an easing between each two, its delay and its duration. */
interface Pass {
  readonly stops: ReadonlyArray<Stop>
  readonly times: ReadonlyArray<number>
  readonly eases: ReadonlyArray<Easing.Definition>
  readonly delay: number
  readonly duration: number
}

/** Whether a step is a label with its own time. */
const isLabel = <S>(step: Step<S>): step is Label => Predicate.hasProperty(step, "name")

/** Whether a time is relative to the end of the Segment before: `"+0.5"`, `"-0.5"`. */
const isFromEnd = (at: string): boolean => Bool.or(Str.startsWith("+")(at), Str.startsWith("-")(at))

/** Whether a time is relative to the start of the Segment before: `"<"`, `"<+0.5"`, `"<-0.5"`. */
const isFromStart = (at: string): boolean => Str.startsWith("<")(at)

/** The time `at` gives (Motion's `calcNextTime`), the Segment before having started at `previous` and ended at `current`. */
const timeOf = (current: number, at: Time, previous: number, labels: ReadonlyMap<string, number>): number =>
  Bool.match(Predicate.isNumber(at), {
    onTrue: () => at as number,
    onFalse: () =>
      Match.value(at as string).pipe(
        Match.when(isFromEnd, (given) => Math.max(0, current + Number.parseFloat(given))),
        Match.when("<", () => previous),
        Match.when(isFromStart, (given) => Math.max(0, previous + Number.parseFloat(given.slice(1)))),
        Match.orElse((name) => UndefinedOr.match(labels.get(name), { onUndefined: () => current, onDefined: identity })),
      ),
  })

/** A key's value or stops, as stops. */
const stopsOf = (given: Stop | ReadonlyArray<Stop>): ReadonlyArray<Stop> =>
  Bool.match(Array.isArray(given), { onTrue: () => given as ReadonlyArray<Stop>, onFalse: () => [given as Stop] })

/** `count` places evenly spread from 0 to 1 (Motion's `defaultOffset`). */
const evenly = (count: number): ReadonlyArray<number> => Arr.makeBy(count, (i) => i / (count - 1))

/** Whether an `ease` is one per part (a list that isn't a bézier's four numbers). */
const isList = (ease: Easing.Definition | ReadonlyArray<Easing.Definition>): ease is ReadonlyArray<Easing.Definition> =>
  Bool.and(Array.isArray(ease), Bool.not(Easing.isBezier(ease)))

/** An easing for each of `parts`, from one or from a list of them, wrapping round (Motion's `getEasingForSegment`). */
const easesFor = (ease: Easing.Definition | ReadonlyArray<Easing.Definition>, parts: number): ReadonlyArray<Easing.Definition> =>
  Bool.match(isList(ease), {
    onTrue: () => Arr.makeBy(parts, (i) => (ease as ReadonlyArray<Easing.Definition>)[i % (ease as ReadonlyArray<Easing.Definition>).length] as Easing.Definition),
    onFalse: () => Arr.makeBy(parts, () => ease as Easing.Definition),
  })

/**
 * A spring from 0 to `move`, sampled into an easing over the time it takes to rest (Motion's
 * `createGeneratorEasing`): its duration, at most `Machine.MAX_DURATION`, and its curve, each sample
 * of `move` scaled to 1. A spring set by time ends at its duration (#359), as its machine does.
 */
const springEasing = (transition: Transition & { readonly type: "spring" }, move: number): { readonly ease: Easing.Easing; readonly duration: number } => {
  const { type: _type, delay: _delay, times: _times, repeat: _repeat, repeatType: _repeatType, repeatDelay: _repeatDelay, reverse: _reverse, ...spring } = transition
  const machine = Machine.spring(move, { ...spring, from: 0 })
  const duration = Math.min(Machine.durationOf(machine), Machine.MAX_DURATION)
  const last = Math.max(1, Math.round(duration * SAMPLES_PER_SECOND))
  const dt = duration / last
  const step = machine.start()
  const samples = Arr.makeBy(last + 1, (i) => step(Bool.match(i === 0, { onTrue: () => 0, onFalse: () => dt })).value / move)
  // Per frame (ADR-0025): early returns, and indexes in range by construction.
  const ease: Easing.Easing = (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const at = t * last
    const lo = Math.floor(at)
    const from = samples[lo]
    return from + (samples[Math.min(lo + 1, last)] - from) * (at - lo)
  }
  return { ease, duration }
}

/** A spring's move between its two stops, or Motion's 0–100 when they aren't two numbers that differ. */
const moveOf = (stops: ReadonlyArray<Stop>): number => {
  const [first, second] = stops
  if (Bool.and(stops.length === 2, Bool.and(Predicate.isNumber(first), Predicate.isNumber(second)))) {
    const move = Math.abs((second as number) - (first as number))
    if (move > 0) return move
  }
  return UNKNOWN_MOVE
}

/** A key's easing and duration in its Segment: a spring through two stops or fewer sampled, else its `ease` and `duration`. */
const timingOf = (transition: Transition, given: ReadonlyArray<Stop>): { readonly ease: Easing.Definition | ReadonlyArray<Easing.Definition>; readonly duration: number } => {
  if (Bool.and(transition.type === "spring", given.length <= 2)) return springEasing(transition as Transition & { readonly type: "spring" }, moveOf(given))
  return {
    ease: UndefinedOr.match((transition as Machine.KeyframesOptions).ease, { onUndefined: () => DEFAULT_EASE, onDefined: identity }),
    duration: UndefinedOr.match(transition.duration, { onUndefined: () => DEFAULT_DURATION, onDefined: identity }),
  }
}

/** A Segment's delay for the subject at `index` of `count`. */
const delayOf = (delay: Delay | undefined, index: number, count: number): number =>
  UndefinedOr.match(delay, {
    onUndefined: () => 0,
    onDefined: (given) => Bool.match(Predicate.isFunction(given), { onTrue: () => (given as (index: number, count: number) => number)(index, count), onFalse: () => given as number }),
  })

/** Whether a Segment's `repeat` unrolls into stops: a whole number of passes from 1 to {@link MAX_REPEAT} less one. */
const unrolls = (repeat: number | undefined): repeat is number =>
  UndefinedOr.match(repeat, { onUndefined: () => false, onDefined: (count) => Bool.and(count > 0, count < MAX_REPEAT) })

/**
 * `pass` played `repeat + 1` times (Motion's): each repeat's stops after the last's, `repeatDelay`
 * holding the last stop between, and `"reverse"` / `"mirror"` turning every other pass, through the
 * stops from last to first. `"mirror"` keeps the easings; `"reverse"` plays them backwards, as a
 * reversed run does, named ones too.
 */
const repeated = (pass: Pass, transition: Transition, repeat: number): Pass => {
  const repeatDelay = UndefinedOr.match(transition.repeatDelay, { onUndefined: () => 0, onDefined: identity })
  const repeatType = UndefinedOr.match(transition.repeatType, { onUndefined: () => "loop" as const, onDefined: identity })
  const gap = Bool.match(pass.duration > 0, { onTrue: () => repeatDelay / pass.duration, onFalse: () => 0 })
  const flips = repeatType !== "loop"
  const turned = Arr.reverse(pass.stops)
  const turnedEases = Bool.match(repeatType === "reverse", {
    onTrue: () => Arr.map(Arr.reverse(pass.eases), (ease): Easing.Definition => Easing.reverse(Easing.resolve(ease))),
    onFalse: () => pass.eases,
  })
  const unrolled = Arr.reduce(Arr.range(0, repeat - 1), { stops: pass.stops, times: pass.times, eases: pass.eases }, (so, index) => {
    const flipped = Bool.and(flips, index % 2 === 0)
    const stops = Bool.match(flipped, { onTrue: () => turned, onFalse: () => pass.stops })
    const eases = Bool.match(flipped, { onTrue: () => turnedEases, onFalse: () => pass.eases })
    const starts = (index + 1) * (1 + gap)
    // The last stop held through the delay, then into the pass's first at once.
    const held = Bool.match(gap > 0, {
      onTrue: () => ({ stops: Arr.append(so.stops, Option.getOrThrow(Arr.last(so.stops))), times: Arr.append(so.times, starts), eases: Arr.append(so.eases, LINEAR) }),
      onFalse: () => so,
    })
    return {
      stops: Arr.appendAll(held.stops, stops),
      times: Arr.appendAll(held.times, Arr.map(pass.times, (time) => time + starts)),
      eases: Arr.appendAll(Arr.append(held.eases, LINEAR), eases),
    }
  })
  const units = repeat + 1 + repeat * gap
  return {
    stops: unrolled.stops,
    times: Arr.map(unrolled.times, (time) => time / units),
    eases: unrolled.eases,
    delay: pass.delay,
    duration: pass.duration * (repeat + 1) + repeatDelay * repeat,
  }
}

/** A key's {@link Pass} in its Segment, for the subject at `index` of `count`. */
const passOf = (given: Stop | ReadonlyArray<Stop>, transition: Transition, index: number, count: number): Pass => {
  const listed = stopsOf(given)
  const { ease, duration } = timingOf(transition, listed)
  // A single value starts from the stop before it.
  const stops = Bool.match(listed.length === 1, { onTrue: () => Arr.prepend(listed, null), onFalse: () => listed })
  const times = UndefinedOr.match(transition.times, {
    onUndefined: () => evenly(stops.length),
    onDefined: (given) => Bool.match(given.length === stops.length, { onTrue: () => given, onFalse: () => evenly(stops.length) }),
  })
  const pass: Pass = { stops, times, eases: easesFor(ease, stops.length - 1), delay: delayOf(transition.delay, index, count), duration }
  return Bool.match(unrolls(transition.repeat), { onTrue: () => repeated(pass, transition, transition.repeat as number), onFalse: () => pass })
}

/** `list` with `pass` placed from `start` to `end`: the stops it had strictly between erased, its own added (Motion's `addKeyframes`). */
const placed = (list: ReadonlyArray<Placed>, pass: Pass, start: number, end: number): ReadonlyArray<Placed> =>
  Arr.appendAll(
    Arr.filter(list, (stop) => Bool.or(stop.at <= start, stop.at >= end)),
    Arr.map(pass.stops, (value, i): Placed => ({ value, at: Scalar.lerp(start, end, UndefinedOr.getOrThrow(pass.times[i])), ease: UndefinedOr.getOrThrow(pass.eases[i % pass.eases.length]) })),
  )

/** Stops in time order, a `null` after a value at the same time (Motion's `compareByTime`). */
const BY_TIME: Order.Order<Placed> = Order.combine(
  Order.mapInput(Order.Number, (stop: Placed) => stop.at),
  Order.mapInput(Order.Boolean, (stop: Placed) => Predicate.isNull(stop.value)),
)

/** A time's place in a sequence of `total` seconds, 0 to 1 (Motion's `progress`: all the way, in one of none). */
const placeOf = (at: number, total: number): number => Bool.match(total === 0, { onTrue: () => 1, onFalse: () => Scalar.clamp(at / total, 0, 1) })

/**
 * A key's animation from its placed stops: in time order, each at its place in the sequence; a first
 * stop after 0 held from it, and the last held to the end with a `null` (Motion's).
 */
const keyAnimationOf = (list: ReadonlyArray<Placed>, total: number, options: Options): readonly [ReadonlyArray<Stop>, DefaultTransition.KeyframesTransition] => {
  const sorted = Arr.sort(list, BY_TIME)
  const first = UndefinedOr.getOrThrow(sorted[0])
  const times = Arr.map(sorted, (stop) => placeOf(stop.at, total))
  const fromStart = Bool.match(UndefinedOr.getOrThrow(times[0]) !== 0, {
    onTrue: () => ({ stops: Arr.prepend(Arr.map(sorted, (stop) => stop.value), first.value), times: Arr.prepend(times, 0), eases: Arr.prepend(Arr.map(sorted, (stop) => stop.ease), HOLD_EASE) }),
    onFalse: () => ({ stops: Arr.map(sorted, (stop) => stop.value), times, eases: Arr.map(sorted, (stop) => stop.ease) }),
  })
  const toEnd = Bool.match(UndefinedOr.getOrThrow(fromStart.times[fromStart.times.length - 1]) !== 1, {
    onTrue: () => ({ ...fromStart, stops: Arr.append(fromStart.stops, null), times: Arr.append(fromStart.times, 1) }),
    onFalse: () => fromStart,
  })
  // The options given, none set to `undefined`.
  const given = Rec.filter(options as Readonly<Record<string, unknown>>, Predicate.isNotUndefined) as Pick<Machine.KeyframesOptions, keyof Options>
  return [toEnd.stops, { type: "tween", duration: total, ease: toEnd.eases, times: toEnd.times, ...given }]
}

/**
 * Compiles a sequence: each subject's animation, in the order the subjects first appear, each of its
 * keys through its stops on one tween over the whole sequence, with `options` laid over each. Run each
 * subject's animation as keyframes, all started together.
 *
 * @example
 * const animations = Sequence.compile(steps, { repeat: 1, repeatType: "reverse" })
 * for (const [subject, animation] of animations) play(subject, animation)
 */
// #433, Motion's `createAnimationsFromSequence`.
export const compile = <S>(steps: ReadonlyArray<Step<S>>, options: Options = NO_OPTIONS): ReadonlyMap<S, Animation> => {
  const labels = new Map<string, number>()
  const bySubject = new Map<S, Map<string, ReadonlyArray<Placed>>>()
  let previous = 0
  let current = 0
  let total = 0
  Arr.forEach(steps, (step) => {
    if (Predicate.isString(step)) {
      labels.set(step, current)
      return
    }
    if (isLabel(step)) {
      labels.set(step.name, timeOf(current, step.at, previous, labels))
      return
    }
    current = UndefinedOr.match(step.at, { onUndefined: () => current, onDefined: (at) => timeOf(current, at, previous, labels) })
    let longest = 0
    const count = step.subjects.length
    Arr.forEach(step.subjects, (subject, index) => {
      let keys = bySubject.get(subject)
      if (Predicate.isUndefined(keys)) {
        keys = new Map()
        bySubject.set(subject, keys)
      }
      const byKey = keys
      Arr.forEach(Rec.toEntries(step.target), ([key, given]) => {
        const transition = UndefinedOr.match(step.transitions[key], { onUndefined: () => TWEEN, onDefined: identity })
        const pass = passOf(given, transition, index, count)
        const start = current + pass.delay
        const end = start + pass.duration
        byKey.set(key, placed(UndefinedOr.match(byKey.get(key), { onUndefined: () => [], onDefined: identity }), pass, start, end))
        longest = Math.max(longest, pass.delay + pass.duration)
        total = Math.max(total, end)
      })
    })
    previous = current
    current += longest
  })
  return new Map(Arr.map(Arr.fromIterable(bySubject), ([subject, keys]): readonly [S, Animation] => {
    const animations = Arr.map(Arr.fromIterable(keys), ([key, list]) => [key, keyAnimationOf(list, total, options)] as const)
    return [subject, {
      keyframes: Rec.fromEntries(Arr.map(animations, ([key, [stops]]) => [key, stops] as const)),
      transition: Rec.fromEntries(Arr.map(animations, ([key, [, transition]]) => [key, transition] as const)),
    }]
  }))
}
