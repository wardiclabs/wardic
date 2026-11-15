/**
 * The few reactive primitives the binding-free modules take from a binding (#209): each binding gives
 * its own, over its framework's graph or, with none, over the latest config it received. A module that
 * takes one never imports a framework, so every binding runs the same code.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: solid's `reactivity.ts`, moved for the spine and its
// neighbours to take from core. Solid 1's and Solid 2's implementations stay in solid
// (`solid-reactivity.ts`, `unstable/v2/solid-reactivity.ts`); Foldkit's is getters over the latest
// delivery, with watches re-checked once a patch (ADR-0071, decision 17).

/** A value read through a function: a signal, a memo, a getter. */
export type Accessor<A> = () => A

/** A change notice: the computation that calls `track` re-runs on each `notify`. */
export interface Trigger {
  readonly track: () => void
  readonly notify: () => void
}

/** A binding's reactive primitives, as the binding-free modules use them. */
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
