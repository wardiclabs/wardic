/**
 * The few reactive primitives the Solid-free modules take from a binding's Solid (#209): the Solid 1
 * binding's (`./solid-reactivity.ts`) or the Solid 2 one's (`./unstable/v2/solid-reactivity.ts`).
 * A module that takes one never imports Solid, so both bindings run the same code.
 *
 * @module
 */

/** A value read through a function: a signal, a memo, a getter. */
export type Accessor<A> = () => A

/** A change notice: the computation that calls `track` re-runs on each `notify`. */
export interface Trigger {
  readonly track: () => void
  readonly notify: () => void
}

/** A binding's reactive primitives, as the Solid-free modules use them. */
export interface Reactivity {
  /** Runs `fn` without tracking what it reads. */
  readonly untrack: <A>(fn: () => A) => A
  /** A {@link Trigger}, made under the current owner. Its `notify` may be called from anywhere. */
  readonly trigger: () => Trigger
  /**
   * Calls `onChange` with each later value of `accessor`, not its first, until the returned stop.
   * In a root of its own, which no owner disposes.
   */
  readonly watch: <A>(accessor: Accessor<A>, onChange: (value: A) => void) => () => void
}
