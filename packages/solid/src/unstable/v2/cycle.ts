/**
 * `createCycle` on Solid 2 (#443, Motion's `useCycle`), as Solid 1's.
 *
 * @module
 */
import { type Accessor, createSignal } from "solid-js"
import { nextIndexOf } from "../../cycle-index.ts"
import type { Cycle } from "../../cycle.ts"

export type { Cycle } from "../../cycle.ts"

/**
 * One of `items` at a time (#443, Motion's `useCycle`): the first to begin with, and `cycle()` steps to
 * the next, the first after the last. `cycle(i)` goes to index `i` as given, unchecked, as Motion's.
 * Anything but a number steps, as Motion's (`typeof next !== "number"`). Two steps before Solid
 * flushes step twice: the index is kept outside the signal too, as Motion keeps it in a ref.
 */
export const createCycle = <T,>(...items: ReadonlyArray<T>): readonly [Accessor<T>, Cycle] => {
  let current = 0
  const [index, setIndex] = createSignal(0)
  const cycle: Cycle = (next) => {
    current = nextIndexOf(current, items.length, next)
    setIndex(current)
  }
  // eslint-disable-next-line solid/reactivity -- the accessor itself is returned, for its caller to read where it tracks
  return [() => items[index()] as T, cycle]
}
