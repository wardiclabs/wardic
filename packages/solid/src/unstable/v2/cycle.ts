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
 * One of a list of values at a time: the first to begin with, and `cycle()` steps to the next, the
 * first after the last. `cycle(i)` goes to index `i`. Two steps in one handler step twice. Motion's
 * `useCycle`, its value an accessor.
 *
 * @example
 * const [x, cycleX] = createCycle(0, 50, 100)
 * <w.div animate={{ x: x() }} onClick={() => cycleX()} />
 * @see https://wardic.dev/reference/solid/utilities/create-cycle
 */
// #443. The index is kept outside the signal too, as Motion keeps it in a ref; `cycle(i)` is taken as
// given, unchecked, and anything but a number steps, as Motion's (`typeof next !== "number"`).
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
