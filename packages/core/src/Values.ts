/**
 * Value bags: `Values`, a flat map of keys to numbers or strings, the shape every animation target
 * takes, and what a binding does with one as it builds an animation: `split` it by kind, and `pick`
 * from it.
 *
 * @example
 * import * as Values from "@wardic/core/Values"
 *
 * const { numbers, strings } = Values.split({ x: 100, opacity: 1, color: "#a3be8c" })
 * // numbers: { x: 100, opacity: 1 }, which a spring moves; strings: { color: "#a3be8c" }, blended
 */
// CONTEXT.md's Variant. Plain shapes callers write, so no prototype (ADR-0028, decision 1). The
// operations run when a leg is built, at a Retarget, never per frame.
import * as Iter from "effect/Iterable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { dual } from "./internal/dual.ts"

/** A flat bag of values: numbers, or strings an Environment blends, such as `"12px"` or a colour. */
export type Values = Record<string, number | string>

/** A named animation state's values. */
export type Variant = Record<string, number | string>

/** Named animation states, which the elements of a component tree share by name. */
export type Variants = Record<string, Variant>

/** A bag's keys by kind: its numbers, which a spring moves, and its strings, which are blended by a progress. */
// `Machine.springValues` and `Machine.springBlend` (ADR-0024).
export interface Split {
  /** Its keys that hold a number. */
  readonly numbers: Record<string, number>
  /** Its keys that hold a string. */
  readonly strings: Values
}

/**
 * `values`' keys by kind: its numbers and its strings. A key holding neither, an `undefined` that reached
 * the bag at run time, is in neither.
 */
export const split = (values: Values): Split => ({
  numbers: Rec.filter(values, Predicate.isNumber),
  strings: Rec.filter(values, Predicate.isString),
})

/**
 * `self`'s values for the keys `keysFrom` has, leaving out a key `self` lacks or holds `undefined` for:
 * where an animation's keys start, from the element's values for the keys it animates to.
 *
 * @example
 * const from = Values.pick(current, target) // current's values for target's keys
 */
export const pick: {
  (keysFrom: Values): (self: Values) => Values
  (self: Values, keysFrom: Values): Values
} = dual(
  2,
  (self: Values, keysFrom: Values): Values => {
    // Per leg (#460): one record, a statement a key, no `Option` made.
    const picked: Record<string, number | string> = {}
    Iter.forEach(Object.keys(keysFrom), (key) => {
      if (!Object.hasOwn(self, key)) return
      const value = self[key]
      if (Predicate.isUndefined(value)) return
      picked[key] = value
    })
    return picked
  },
)
