/**
 * `createCycle`'s step, Solid-free, on both bindings (#443).
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"

/**
 * The index a cycle's step goes to from `current` among `length` items (Motion's `useCycle`): `next`
 * when it's a number, as given; else the one after `current`, the first after the last (Motion's
 * `wrap`).
 */
export const nextIndexOf = (current: number, length: number, next: unknown): number =>
  Bool.match(Predicate.isNumber(next), {
    onTrue: () => next as number,
    onFalse: () => (current + 1) % length,
  })
