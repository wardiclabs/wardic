/**
 * A Reorder group's `values` as its group reads them (#721, ADR-0037 *Amendment (#721)*): a plain array as
 * it is, and a store's order copied into one at each read. So a store changed in place reads as a new order,
 * every check of the order sees a plain array, and a tracked read tracks each item, an untracked one none.
 * Read fresh each time, not in a memo: a Solid 2 memo takes a hydration id the server's group doesn't, and
 * read in a flush's cleanup it can still have the order before it.
 *
 * @module
 */
import * as Arr from "effect/Array"

/**
 * `values` as a plain array: a copy when it's a store's, `proxy` the binding's Solid's store marker. Read at
 * each drag sample (core's crossover), so it builds nothing to decide.
 */
export const plainOrder = <V>(values: ReadonlyArray<V>, proxy: symbol): ReadonlyArray<V> => {
  // Once an input event (#721): statements.
  if (proxy in values) return Arr.copy(values)
  return values
}
