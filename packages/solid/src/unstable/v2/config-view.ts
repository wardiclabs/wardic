/**
 * A config read per key (#259, ADR-0045 *Amendment (#259)*): what the Solid 2 binding's `ward()`,
 * `reorderGroup()` and `reorderItem()` read their config through.
 *
 * - **Per key.** Reading a key of the view reads that key of the source, so Solid tracks it alone: a
 *   getter, a store's property or a component's prop is tracked as it's read. A change re-runs only
 *   the computations that read that key, where an accessor of the whole config re-ran them all.
 * - **A function is an accessor,** called as it's read (so tracked too): `ward({ animate: () => … })`.
 *   The callback keys (`onUpdate`, `onReorder`…) hold functions as their values, and are read as they are.
 * - **A plain value is a constant,** as a literal prop is.
 *
 * The view is one object over the source, its getters on a prototype made once per kind of config,
 * so making one allocates no getters. It has no keys of its own: it is read, never spread. A setup
 * read (a read-once key: `initial`, `drag`, `layout`) goes through {@link snapshotOf}, untracked, or
 * {@link setupOf}, which notes the keys still loading rather than throwing (#257 item 1).
 *
 * An accessor that returns a promise is an error naming its key (#257 item 1, Q3): an accessor is
 * called at every read of its key, so it would fetch again at each; an async memo (`createMemo(() =>
 * fetch…)`) caches it, and is read as any other accessor.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { latest, NotReadyError, runWithOwner, untrack } from "solid-js"
import type { Accessor } from "solid-js"

/**
 * A config whose keys may each be an accessor (#259): a key's value, or a function returning it,
 * except the callback keys `K`, whose values are functions themselves.
 */
export type PerKey<C, K extends keyof C = never> = {
  readonly [P in keyof C]: P extends K ? C[P] : C[P] | Accessor<C[P]>
}

/**
 * {@link PerKey}, declared apart, its rule and its accessor written out again: the same config, a
 * type of its own. A ward's config checks its other keys against it (`WardChecked`, #306). Against
 * `PerKey`'s own type, which the config is also bound by, TS met each key's type while it was still
 * working it out, read it as `any`, and an editor completed nothing inside `style` or `viewport`.
 * A rule or an `Accessor<…>` shared between the two did the same, as TS shares their instantiations.
 */
export type PerKeyApart<C, K extends keyof C = never> = {
  readonly [P in keyof C]: P extends K ? C[P] : C[P] | (() => C[P])
}

/** A view's state: the source it reads, and the values it fixes over it. */
class View {
  constructor(
    readonly source: Readonly<Record<string, unknown>>,
    readonly fixed: Readonly<Record<string, unknown>> | undefined,
  ) {}
}

/** `key`'s value in a view: its fixed one, else its source's. */
const valueAt = (view: View, key: string): unknown => {
  const fixed = view.fixed
  if (Predicate.isNotUndefined(fixed)) {
    if (Object.hasOwn(fixed, key)) return fixed[key]
  }
  return view.source[key]
}

/** A config's values fixed over a source's: each a value or an accessor of it, read as the source's are. */
export type Fixed<C> = { readonly [K in keyof C]?: C[K] | Accessor<C[K]> }

/** How to make and copy one kind of config's views: its keys, read per key. */
export interface ConfigView<C> {
  /**
   * A view of `source`, with `fixed`'s values over it (a key it fixes isn't read from the source),
   * each read as the source's are. Its reads are tracked where they're read.
   */
  readonly of: (source: object, fixed?: Fixed<C>) => C
  /** A plain copy of a view's keys as they are now, read untracked: the config at setup. */
  readonly snapshotOf: (view: C) => C
  /**
   * {@link snapshotOf}, a key still loading left out of the copy and named in `pending` (#257 item 1):
   * its read threw Solid's `NotReadyError`. Read with no reader, so nothing re-runs when it lands;
   * the ward's tracked reads of it (its target, its style) wait on it instead.
   */
  readonly setupOf: (view: C) => Setup<C>
}

/** A config at setup: the keys read, and those still loading (#257 item 1). */
export interface Setup<C> {
  readonly config: C
  readonly pending: ReadonlyArray<keyof C & string>
}

/** No key still loading: most setups. */
const NONE_PENDING: ReadonlyArray<never> = []

/** The error for an accessor that returned a promise (#257 item 1, Q3). */
const promiseError = (key: string): Error =>
  new Error(`\`${key}\`'s accessor returned a promise: give it an async memo instead, \`${key}: createMemo(() => …)\`. An accessor is called at every read of its key, so it would fetch at each.`)


/**
 * The views of a config with `keys`, its `callbacks` read as they are: a class of {@link View}
 * whose prototype has a getter a key, made once per kind, at module load.
 */
export const configView = <C extends object>(keys: ReadonlyArray<keyof C & string>, callbacks: ReadonlyArray<keyof C & string>): ConfigView<C> => {
  class KindView extends View {}
  Arr.forEach(keys, (key) => {
    const called = Bool.not(Arr.contains(callbacks, key))
    Object.defineProperty(KindView.prototype, key, {
      enumerable: true,
      get(this: View): unknown {
        const value = valueAt(this, key)
        if (Bool.not(Bool.and(called, Predicate.isFunction(value)))) return value
        const result = (value as () => unknown)()
        if (Predicate.isPromiseLike(result)) throw promiseError(key)
        return result
      },
    })
  })
  const snapshot = (view: C): C =>
    Arr.reduce(keys, {} as Record<string, unknown>, (copy, key) => {
      const value = (view as Record<string, unknown>)[key]
      if (Predicate.isNotUndefined(value)) copy[key] = value
      return copy
    }) as C
  // The setup copy: a key whose read throws `NotReadyError` is left out and named.
  const setup = (view: C): Setup<C> => {
    let pending: Array<keyof C & string> | undefined
    const config = Arr.reduce(keys, {} as Record<string, unknown>, (copy, key) => {
      let value: unknown
      try {
        value = (view as Record<string, unknown>)[key]
      } catch (error) {
        if (Bool.not(error instanceof NotReadyError)) throw error
        if (Predicate.isUndefined(pending)) pending = []
        pending.push(key)
        return copy
      }
      if (Predicate.isNotUndefined(value)) copy[key] = value
      return copy
    }) as C
    return { config, pending: UndefinedOr.match(pending, { onUndefined: () => NONE_PENDING, onDefined: identity }) }
  }
  return {
    of: (source, fixed) => new KindView(source as Record<string, unknown>, fixed as Record<string, unknown> | undefined) as unknown as C,
    snapshotOf: (view) => untrack(() => snapshot(view)),
    // With no reader, and untracked: Solid links a pending node to the reader of an untracked read,
    // re-running it when the node settles, so a component's body read would re-run the render that
    // made it, making its async source again (#257 item 1). With none, the read just throws.
    // `untrack` also lifts the dev build's strict read of a component body, which would throw first.
    // And under `latest` (#335): a read outside the update's owner tree sees the values from before
    // it, so a `<Show>`'s narrowed accessor read `undefined`; `latest` reads the in-flight ones, as
    // the element's own render does.
    setupOf: (view) => runWithOwner(null, () => untrack(() => latest(() => setup(view)))),
  }
}
