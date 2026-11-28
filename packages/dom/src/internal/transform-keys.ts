/**
 * The DOM's transform keys, each with its identity: core's (`BaseValue.TRANSFORM_IDENTITY`), and the DOM's
 * own, `transformPerspective`, a depth no other Environment draws. Every DOM reader of a transform key
 * reads this table, so the DOM's own keys are transforms to each of them: the renderer, Own values, a
 * Batch's members, Appear, reduced motion and the Default transition.
 *
 * @module
 */
// #887 (ADR-0073, *Amendment (#887)*, Q1): core names no key only the page draws. As `positional-keys.ts`
// adds the box's keys to core's transforms, this adds the DOM's own transform keys to core's. #1002 would
// move here, at a major, the six of core's that only the DOM draws. TK1 pins that no dom source reads
// core's table but this module.
import * as BaseValue from "@wardic/core/BaseValue"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"

/** An element's own depth, Motion's key: `perspective()` at the head of its transform, in px. */
export const PERSPECTIVE = "transformPerspective"

/**
 * Each of the DOM's transform keys, with its identity: core's, and {@link PERSPECTIVE}'s 0. That 0 is no
 * perspective, not a depth: it's left out of the transform, as Motion's is.
 */
export const TRANSFORM_IDENTITY: Readonly<Record<string, number>> = Object.freeze({ ...BaseValue.TRANSFORM_IDENTITY, [PERSPECTIVE]: 0 })

/** A DOM transform key's identity (see {@link TRANSFORM_IDENTITY}), or `None` for any other key, prototype names included. */
export const transformIdentity = (key: string): Option.Option<number> => Rec.get(TRANSFORM_IDENTITY, key)

/** The DOM's transform keys, for a membership test a frame can make. */
export const TRANSFORM_KEYS: ReadonlySet<string> = new Set(Object.keys(TRANSFORM_IDENTITY))

/** Whether `key` is one of the DOM's transform keys. */
export const isTransformKey = (key: string): boolean => TRANSFORM_KEYS.has(key)

/**
 * Whether the element's own depth draws a `perspective()`: above its identity, 0, which is no
 * perspective. A depth below 0 isn't drawn either: CSS refuses a negative `perspective()`, and the whole
 * `transform` with it, so a spring's overshoot past 0 draws no perspective. A string is read as Motion
 * reads one, by `parseFloat`, and drawn when it can't be read (`var(--d)`). Per frame: statements.
 */
// #887 (ADR-0073, *Amendment (#887)*, Q3): the renderer's, a projected element's and a Batch member's.
export const drawsDepth = (value: unknown): boolean => {
  if (Predicate.isNumber(value)) return value > 0
  const read = Number.parseFloat(String(value))
  return Number.isNaN(read) || read > 0
}
