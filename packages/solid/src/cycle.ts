/**
 * `createCycle` on Solid 1 (#443, Motion's `useCycle`): one of a list of states at a time, stepped
 * through.
 *
 * @module
 */
import { type Accessor, createSignal } from "solid-js"
import { nextIndexOf } from "./cycle-index.ts"

/** `createCycle`'s step (Motion's `Cycle`): to the next item, the first after the last, or to index `i`. */
export type Cycle = (i?: number) => void

/**
 * One of `items` at a time (#443, Motion's `useCycle`): the first to begin with, and `cycle()` steps to
 * the next, the first after the last. `cycle(i)` goes to index `i` as given, unchecked, as Motion's.
 * Anything but a number steps, as Motion's (`typeof next !== "number"`).
 *
 * ```tsx
 * const [x, cycleX] = createCycle(0, 50, 100)
 * <wardic.div animate={{ x: x() }} onTap={() => cycleX()} />
 * ```
 */
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
