/**
 * Live values in `style` (#130, ADR-0043): which of a user's `style` keys Wardic writes through the
 * flush gate, what each is now, and when one changes.
 *
 * A key is **routed** when its value is live (an `effect/reactivity` Atom, or an accessor: a signal,
 * a memo, `createTransform`'s) or when it's a transform key (`x`, `scale`, `rotate`…), live or not
 * (decisions 2 and 4). A routed key is the key's `style` link, followed while no entry of the
 * Override stack sets it (decision 1), and Wardic writes it: the gate composes the transform keys
 * into `transform` with its own, and commits the rest once a frame. So Solid's `style` never
 * carries one. A user's own `transform` string applies while no transform key is set; with one,
 * the keys win (Motion's rule): the gate holds `transform`, so Solid never writes the string, and a
 * warning is logged once per element.
 *
 * The binding reads its user's style reactively in one place, its element's `style`, so that's
 * where `css` sees each new one. Following starts at mount, or at the first routed key after it
 * (`whenRouted`): from then on, a change of a routed key's value, a new source for it, or its
 * leaving the style, is told to the spine, which writes it while nothing else owns the key. An Atom is subscribed; an accessor gets its own
 * computation, one per key, so a change runs only that.
 *
 * Solid-free: both bindings run it, each giving its own Solid as a {@link Reactivity} (#209).
 */
import * as BaseValue from "@wardic/core/BaseValue"
import * as LiveValue from "@wardic/core/LiveValue"
import type * as Values from "@wardic/core/Values"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Accessor, Reactivity } from "./reactivity.ts"
import type { WardicRuntime } from "./runtime.ts"

/** A Live value as Solid takes it: an `effect/reactivity` Atom, or an accessor (a signal, a memo). */
export type LiveSource<A> = Atom.Atom<A> | Accessor<A>

/** A `style` value: as it is, or live. */
export type Live<A> = A | LiveSource<A>

/** A user's style as a binding hands it over: a record, CSS text, or none. */
type StyleInput = object | string | undefined

/** Whether a style value is live: an Atom, or an accessor. */
export const isLive = (value: unknown): value is LiveSource<unknown> => Bool.or(Atom.isAtom(value), Predicate.isFunction(value))

/** Where an accessor keeps the Atom it carries (#209 PR 3's Q2). */
const CARRIED = Symbol.for("@wardic/solid/carried")

/**
 * `accessor`, carrying `atom`: the Atom it reads, so a `style` that's given it follows the Atom
 * itself, set where the Atom is, rather than the accessor through Solid (#209 PR 3's Q2). On Solid
 * 2 an accessor's change shows at Solid's flush, after the gate's write: a value derived from a
 * ward's would paint a frame late. Both must give the same value.
 */
export const carry = <A>(accessor: Accessor<A>, atom: Atom.Atom<A>): Accessor<A> =>
  Object.defineProperty(accessor, CARRIED, { value: atom })

/** `createSpring`'s value (#257 item 7): an accessor carrying the spring's Atom, with Motion's `jump`. */
export interface SpringAccessor extends Accessor<number> {
  /**
   * Set the spring to `value` at once, not as motion (Motion's `MotionValue.jump`): its run ends
   * there with no velocity, and it rests there until its source next changes, then springs from
   * there. A `createVelocity` of it reads 0 across the jump. On a server, it does nothing.
   */
  readonly jump: (value: number) => void
}

/** `accessor`, carrying a spring's Atom, with `jump` run on `runtime`. */
export const springAccessorOf = (runtime: WardicRuntime, accessor: Accessor<number>): SpringAccessor => {
  const atom = atomOf(accessor) as Atom.Atom<number>
  return Object.assign(accessor, {
    jump: (value: number): void => {
      runtime.runSync(LiveValue.jump(atom, value))
    },
  })
}

/** A server's spring: `read`, as it is now, and a `jump` that does nothing (ADR-0021). */
export const serverSpringOf = (read: Accessor<number>): SpringAccessor => Object.assign(() => read(), { jump: constVoid })

/** The Atom a Live value is, or carries: `undefined` for a plain accessor or a plain value. Per key, per change: guards, no matcher. */
export const atomOf = (value: unknown): Atom.Atom<unknown> | undefined => {
  if (Atom.isAtom(value)) return value as Atom.Atom<unknown>
  if (Bool.not(Predicate.isFunction(value))) return undefined
  return (value as { readonly [CARRIED]?: Atom.Atom<unknown> })[CARRIED]
}

/** Whether `key` is a transform key, composed into `transform` (`x`, `scale`, `rotate`…). */
export const isTransformKey = (key: string): boolean => Option.isSome(BaseValue.transformIdentity(key))

/** A style value, read now: an Atom (or the one an accessor carries) through `registry`, an accessor untracked, anything else as it is. */
export const readLive = (value: unknown, registry: () => AtomRegistry.AtomRegistry, untrack: Reactivity["untrack"]): unknown => {
  const atom = atomOf(value)
  if (Predicate.isNotUndefined(atom)) return registry().get(atom)
  if (Predicate.isFunction(value)) return untrack(value as Accessor<unknown>)
  return value
}

/** Whether a style's `key` is routed: its value is live, or it's a transform key with a value. */
const isRouted = (value: unknown, key: string): boolean =>
  Bool.and(Predicate.isNotNullish(value), Bool.or(isLive(value), isTransformKey(key)))

/** A user's style split: what Solid's `style` carries, and the routed keys' sources. */
export interface Split {
  /** The style without the routed keys. The user's own when nothing is routed. */
  readonly css: StyleInput
  /** Each routed key's value as given: an Atom, an accessor, or a transform key's plain value. */
  readonly routed: Readonly<Record<string, unknown>>
  /** Whether a `transform` string was dropped for the transform keys. */
  readonly droppedTransform: boolean
}

const NOTHING_ROUTED: Readonly<Record<string, unknown>> = {}
const NO_VALUES: Values.Values = {}
/** No style: nothing routed. */
const NO_STYLE: Split = { css: undefined, routed: NOTHING_ROUTED, droppedTransform: false }

/** A user's style, split into Solid's part and the routed keys (CSS text parsed when it has one). */
export const split = (user: StyleInput): Split => {
  if (Predicate.isUndefined(user)) return NO_STYLE
  const record = Style.over(user, undefined)
  const routed = Rec.filter(record, isRouted)
  if (Rec.isEmptyRecord(routed)) return { css: user, routed: NOTHING_ROUTED, droppedTransform: false }
  const droppedTransform = Bool.and(Arr.some(Rec.keys(routed), isTransformKey), Predicate.isNotNullish(record["transform"]))
  // A `transform` string stays: the gate holds `transform` while a transform key is routed, so it's
  // left out of what Solid writes, and shows again once none is.
  const css = Rec.filter(record, (_, key) => Bool.not(Object.hasOwn(routed, key)))
  return { css, routed, droppedTransform }
}

/** The routed keys' values, read now: the numbers and strings among them, as a values map. */
export const valuesOf = (
  routed: Readonly<Record<string, unknown>>,
  registry: () => AtomRegistry.AtomRegistry,
  untrack: Reactivity["untrack"],
): Values.Values =>
  Bool.match(routed === NOTHING_ROUTED, {
    onTrue: () => NO_VALUES,
    onFalse: () => Style.toValues(Rec.map(routed, (value) => readLive(value, registry, untrack))),
  })

/** What the spine hears while it follows. */
export interface Follower {
  /** A routed key's value changed, or its source did: `value` is its value now. */
  readonly change: (key: string, value: unknown) => void
  /** A routed key left the style. */
  readonly removed: (key: string) => void
}

/** An element's routed `style` keys, seen through its `style` and followed from mount. */
export interface LiveStyle {
  /** Sees the user's `style` (reconciling the routed keys), and gives Solid's part of it. Called where the binding reads it reactively. */
  readonly css: (user: StyleInput) => StyleInput
  /** The routed keys' values now, as a values map: the Starting style's. */
  readonly values: () => Values.Values
  /** Whether `key` is routed now. */
  readonly routes: (key: string) => boolean
  /** A routed key's value now, `None` when it isn't routed. */
  readonly valueOf: (key: string) => Option.Option<unknown>
  /** Whether a routed key's source is live, so a return to it follows it (decision 6). */
  readonly isLive: (key: string) => boolean
  /** A style value read now, live or not. */
  readonly read: (value: unknown) => unknown
  /**
   * Follow, from the first routed key on: `setup` is called once, at once if a key is routed now,
   * else when one first is, and the follower it gives hears every change from then on, until
   * `stop`. Its first call is where the element's routed keys are first written. An element whose
   * `style` never routes a key never calls it.
   */
  readonly whenRouted: (setup: () => Follower) => void
  /** Stop following, and every watch with it. */
  readonly stop: () => void
}

/** What {@link createLiveStyle} reads. */
export interface LiveStyleOptions {
  /** The registry Atoms are read through: the provider's on a client, a fresh one on a server. */
  readonly registry: () => AtomRegistry.AtomRegistry
  /** Called once, the first time a `transform` string is dropped for the transform keys. */
  readonly onDroppedTransform?: (() => void) | undefined
  /** The binding's Solid: accessors are read untracked, and watched, through it (#209). */
  readonly reactivity: Reactivity
}

/** A {@link LiveStyle}'s state: one object per element, its methods on {@link Proto}. */
interface State extends LiveStyle {
  readonly registry: () => AtomRegistry.AtomRegistry
  readonly onDroppedTransform: (() => void) | undefined
  readonly reactivity: Reactivity
  routed: Readonly<Record<string, unknown>>
  seen: StyleInput
  last: StyleInput
  warned: boolean
  follower: Follower | undefined
  // The follower's setup, until a key is first routed.
  pending: (() => Follower) | undefined
  // While following: each routed key's stop (an Atom's unsubscribe, an accessor's root disposal),
  // made at the first watch: most elements watch none.
  watching: Map<string, () => void> | undefined
}

/**
 * Watch `key`'s live source for `to`: an Atom, or the one an accessor carries, subscribed; any
 * other accessor in a computation of its own.
 */
const watch = (self: State, key: string, source: unknown, to: Follower): void => {
  if (Bool.not(isLive(source))) return
  if (Predicate.isUndefined(self.watching)) self.watching = new Map()
  const atom = atomOf(source)
  if (Predicate.isNotUndefined(atom)) {
    self.watching.set(key, self.registry().subscribe(atom, (value) => to.change(key, value)))
    return
  }
  self.watching.set(key, self.reactivity.watch(source as Accessor<unknown>, (value) => to.change(key, value)))
}

const unwatch = (self: State, key: string): void => {
  if (Predicate.isUndefined(self.watching)) return
  const stop = self.watching.get(key)
  if (Predicate.isUndefined(stop)) return
  self.watching.delete(key)
  stop()
}

/** Build the follower and watch every routed key. */
const start = (self: State, setup: () => Follower): void => {
  self.pending = undefined
  const to = setup()
  self.follower = to
  Arr.forEach(Rec.keys(self.routed), (key) => watch(self, key, self.routed[key], to))
}

/** The routed keys now `next`: what left is removed, what's new or changed is watched and told. */
const reconcile = (self: State, next: Readonly<Record<string, unknown>>): void => {
  const prev = self.routed
  // Nothing routed, as before: the usual style.
  if (next === prev) return
  self.routed = next
  // The first routed key: the follower's setup writes them all.
  if (Bool.and(Predicate.isNotUndefined(self.pending), Bool.not(Rec.isEmptyRecord(next)))) {
    start(self, UndefinedOr.getOrThrow(self.pending))
    return
  }
  const to = self.follower
  if (Predicate.isUndefined(to)) return
  Arr.forEach(Rec.keys(prev), (key) => {
    if (Object.hasOwn(next, key)) return
    unwatch(self, key)
    to.removed(key)
  })
  Arr.forEach(Rec.keys(next), (key) => {
    const source = next[key]
    if (Bool.and(Object.hasOwn(prev, key), prev[key] === source)) return
    unwatch(self, key)
    watch(self, key, source, to)
    to.change(key, readLive(source, self.registry, self.reactivity.untrack))
  })
}

const Proto: Omit<LiveStyle, never> & ThisType<State> = {
  css(user) {
    // The same style object as last time: the same answer (Solid may read `style` more than once).
    if (Bool.and(user === this.seen, Predicate.isNotUndefined(this.seen))) return this.last
    this.seen = user
    const parts = split(user)
    if (Bool.and(parts.droppedTransform, Bool.not(this.warned))) {
      this.warned = true
      UndefinedOr.match(this.onDroppedTransform, { onUndefined: constVoid, onDefined: (warn) => warn() })
    }
    this.last = parts.css
    reconcile(this, parts.routed)
    return this.last
  },
  values() {
    return valuesOf(this.routed, this.registry, this.reactivity.untrack)
  },
  routes(key) {
    return Object.hasOwn(this.routed, key)
  },
  valueOf(key) {
    return Option.map(Option.liftPredicate(this.routed, (routed) => Object.hasOwn(routed, key)), (routed) => readLive(routed[key], this.registry, this.reactivity.untrack))
  },
  isLive(key) {
    return Bool.and(Object.hasOwn(this.routed, key), isLive(this.routed[key]))
  },
  read(value) {
    return readLive(value, this.registry, this.reactivity.untrack)
  },
  whenRouted(setup) {
    if (Rec.isEmptyRecord(this.routed)) {
      this.pending = setup
      return
    }
    start(this, setup)
  },
  stop() {
    this.follower = undefined
    this.pending = undefined
    const watching = this.watching
    if (Predicate.isUndefined(watching)) return
    Arr.forEach(Arr.fromIterable(watching.keys()), (key) => unwatch(this, key))
  },
}

/**
 * An element's {@link LiveStyle}: one object, its methods shared, so an element that routes nothing
 * pays for little more than it. Creates computations for accessors while it follows; their roots
 * are its own. Call its methods on it (`live.read(v)`), not detached.
 */
export const createLiveStyle = (options: LiveStyleOptions): LiveStyle => {
  const state: Omit<State, keyof LiveStyle> = {
    registry: options.registry,
    onDroppedTransform: options.onDroppedTransform,
    reactivity: options.reactivity,
    routed: NOTHING_ROUTED,
    seen: undefined,
    last: undefined,
    warned: false,
    follower: undefined,
    pending: undefined,
    watching: undefined,
  }
  return Object.assign(Object.create(Proto), state)
}

/** A server's registry, made on first need: an Atom read there gives its own initial value (ADR-0021). */
let serverRegistry: AtomRegistry.AtomRegistry | undefined
export const serverRegistryOf = (): AtomRegistry.AtomRegistry => {
  if (Predicate.isUndefined(serverRegistry)) serverRegistry = AtomRegistry.make()
  return serverRegistry
}
