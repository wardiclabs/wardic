/**
 * Which of a Subject's callbacks are in a run of throws, by name: a callback's run starts at its first
 * throw and ends at its next call that returns. The set of names is made at the first throw, as most
 * Subjects never see one.
 *
 * @module
 */
// #979 group I (ADR-0074 decision 3): an element's gesture callbacks, a layout node's callbacks and a drag
// track's failures, each reported at its run's first throw.
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/** What holds a Subject's failing names: `undefined` until its first throw. */
export interface Failing<N extends string> {
  failing: Set<N> | undefined
}

/** Whether a throw of `name`'s is its run's first: the run is on from now. */
export const firstThrowOf = <N extends string>(holder: Failing<N>, name: N): boolean => {
  const failing = UndefinedOr.match(holder.failing, {
    onUndefined: () => {
      const made = new Set<N>()
      holder.failing = made
      return made
    },
    onDefined: identity,
  })
  if (failing.has(name)) return false
  failing.add(name)
  return true
}

/** A clean call of `name`'s: its run, if one is on, ended. */
export const endRunOf = <N extends string>(holder: Failing<N>, name: N): void => {
  if (Predicate.isNotUndefined(holder.failing)) holder.failing.delete(name)
}
