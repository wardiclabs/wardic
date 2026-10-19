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
 * where `css` sees each new one. Following starts at mount (`follow`): from then on, a change of a
 * routed key's value, a new source for it, or its leaving the style, is told to the spine, which
 * writes it while nothing else owns the key. An Atom is subscribed; an accessor gets its own
 * computation, one per key, so a change runs only that.
 */
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Values from "@wardic/core/Values"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createComputed, createRoot, on, untrack } from "solid-js"

/** A Live value as Solid takes it: an `effect/reactivity` Atom, or an accessor (a signal, a memo). */
export type LiveSource<A> = Atom.Atom<A> | Accessor<A>

/** A `style` value: as it is, or live. */
export type Live<A> = A | LiveSource<A>

/** A user's style as a binding hands it over: a record, CSS text, or none. */
type StyleInput = object | string | undefined

/** Whether a style value is live: an Atom, or an accessor. */
export const isLive = (value: unknown): value is LiveSource<unknown> => Bool.or(Atom.isAtom(value), Predicate.isFunction(value))

/** Whether `key` is a transform key, composed into `transform` (`x`, `scale`, `rotate`…). */
export const isTransformKey = (key: string): boolean => Option.isSome(BaseValue.transformIdentity(key))

/** A style value, read now: an Atom through `registry`, an accessor untracked, anything else as it is. */
export const readLive = (value: unknown, registry: () => AtomRegistry.AtomRegistry): unknown => {
  if (Atom.isAtom(value)) return registry().get(value)
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
export const valuesOf = (routed: Readonly<Record<string, unknown>>, registry: () => AtomRegistry.AtomRegistry): Values.Values =>
  Bool.match(routed === NOTHING_ROUTED, {
    onTrue: () => NO_VALUES,
    onFalse: () => Style.toValues(Rec.map(routed, (value) => readLive(value, registry))),
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
  /** Start following: `follower` hears every change from now on, until the returned stop. */
  readonly follow: (follower: Follower) => () => void
}

/** What {@link createLiveStyle} reads. */
export interface LiveStyleOptions {
  /** The registry Atoms are read through: the provider's on a client, a fresh one on a server. */
  readonly registry: () => AtomRegistry.AtomRegistry
  /** Called once, the first time a `transform` string is dropped for the transform keys. */
  readonly onDroppedTransform?: (() => void) | undefined
}

/** An element's {@link LiveStyle}. Creates computations for accessors while it follows; their roots are its own. */
export const createLiveStyle = (options: LiveStyleOptions): LiveStyle => {
  const { registry, onDroppedTransform } = options
  let routed: Readonly<Record<string, unknown>> = NOTHING_ROUTED
  let seen: StyleInput
  let css: StyleInput
  let warned = false
  let follower: Follower | undefined
  // While following: each routed key's stop (an Atom's unsubscribe, an accessor's root disposal),
  // made at the first watch: most elements watch none.
  let watching: Map<string, () => void> | undefined

  const read = (value: unknown): unknown => readLive(value, registry)

  const watch = (key: string, source: unknown, to: Follower): void => {
    if (Bool.not(isLive(source))) return
    if (Predicate.isUndefined(watching)) watching = new Map()
    if (Atom.isAtom(source)) {
      watching.set(key, registry().subscribe(source, (value) => to.change(key, value)))
      return
    }
    if (Predicate.isFunction(source)) {
      const accessor = source as Accessor<unknown>
      watching.set(
        key,
        createRoot((dispose) => {
          createComputed(on(accessor, (value) => to.change(key, value), { defer: true }))
          return dispose
        }),
      )
    }
  }

  const unwatch = (key: string): void => {
    if (Predicate.isUndefined(watching)) return
    const stop = watching.get(key)
    if (Predicate.isUndefined(stop)) return
    watching.delete(key)
    stop()
  }

  /** The routed keys now `next`: what left is removed, what's new or changed is watched and told. */
  const reconcile = (next: Readonly<Record<string, unknown>>): void => {
    const prev = routed
    // Nothing routed, as before: the usual style.
    if (next === prev) return
    routed = next
    if (Predicate.isUndefined(follower)) return
    const to = follower
    Arr.forEach(Rec.keys(prev), (key) => {
      if (Object.hasOwn(next, key)) return
      unwatch(key)
      to.removed(key)
    })
    Arr.forEach(Rec.keys(next), (key) => {
      const source = next[key]
      if (Bool.and(Object.hasOwn(prev, key), prev[key] === source)) return
      unwatch(key)
      watch(key, source, to)
      to.change(key, read(source))
    })
  }

  return {
    css: (user) => {
      // The same style object as last time: the same answer (Solid may read `style` more than once).
      if (Bool.and(user === seen, Predicate.isNotUndefined(seen))) return css
      seen = user
      const parts = split(user)
      if (Bool.and(parts.droppedTransform, Bool.not(warned))) {
        warned = true
        UndefinedOr.match(onDroppedTransform, { onUndefined: () => undefined, onDefined: (warn) => warn() })
      }
      css = parts.css
      reconcile(parts.routed)
      return css
    },
    values: () => valuesOf(routed, registry),
    routes: (key) => Object.hasOwn(routed, key),
    valueOf: (key) => Option.map(Option.liftPredicate(key, (k: string) => Object.hasOwn(routed, k)), (k) => read(routed[k])),
    isLive: (key) => Bool.and(Object.hasOwn(routed, key), isLive(routed[key])),
    read,
    follow: (to) => {
      follower = to
      Arr.forEach(Rec.keys(routed), (key) => watch(key, routed[key], to))
      return () => {
        follower = undefined
        if (Predicate.isUndefined(watching)) return
        Arr.forEach(Arr.fromIterable(watching.keys()), unwatch)
      }
    },
  }
}

/** A server's registry, made on first need: an Atom read there gives its own initial value (ADR-0021). */
let serverRegistry: AtomRegistry.AtomRegistry | undefined
export const serverRegistryOf = (): AtomRegistry.AtomRegistry => {
  if (Predicate.isUndefined(serverRegistry)) serverRegistry = AtomRegistry.make()
  return serverRegistry
}
