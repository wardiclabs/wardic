/**
 * The `Values` module: a flat bag of animatable values, the variants a component tree names
 * (CONTEXT.md's Variant), and the operations a binding runs on a value-map when it builds a
 * leg: `split`, by kind, and `pick`. Plain shapes callers write, so no prototype (ADR-0028,
 * decision 1). The operations run when a leg is built, at a Retarget, never per frame.
 */
import * as Iter from "effect/Iterable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { dual } from "./internal/dual.ts"

/** A flat bag of animatable values: numbers, or strings its Environment's Interpolators blend. */
export type Values = Record<string, number | string>

/** A named animation state. */
export type Variant = Record<string, number | string>

/** A map of variant name → values, propagated through the component tree. */
export type Variants = Record<string, Variant>

/**
 * A value-map's keys by kind: its numbers, which a spring drives (`Machine.springValues`), and
 * its strings, blended through the `InterpolatorRegistry` by a progress (`Machine.springBlend`,
 * ADR-0024).
 */
export interface Split {
  readonly numbers: Record<string, number>
  readonly strings: Values
}

/**
 * `values`' keys by kind: its numbers and its strings. A key whose value is neither (an
 * `undefined` that reached the map at run time) is in neither.
 */
export const split = (values: Values): Split => ({
  numbers: Rec.filter(values, Predicate.isNumber),
  strings: Rec.filter(values, Predicate.isString),
})

/**
 * The keys of `keysFrom` read out of `self`: for each, `self`'s value, and a key `self` doesn't
 * have (or holds `undefined` for) is skipped. A spring's string keys start this way, from the
 * values the element had (`self`) for the keys it animates to (`keysFrom`).
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
