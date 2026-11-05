/**
 * `createCycle` on Solid 1 (#443, Motion's `useCycle`): one of a list of states at a time, stepped
 * through.
 *
 * @module
 */
import { type Accessor, createSignal } from "solid-js"
import { nextIndexOf } from "./cycle-index.ts"

/** `createCycle`'s step: to the next value, the first after the last, or to index `i`. Motion's `Cycle`. */
export type Cycle = (i?: number) => void

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
  // The index as a plain variable too, as Motion's ref: two steps in one handler step twice.
  let current = 0
  const [index, setIndex] = createSignal(0)
  const cycle: Cycle = (next) => {
    current = nextIndexOf(current, items.length, next)
    setIndex(current)
  }
  return [() => items[index()] as T, cycle]
}
