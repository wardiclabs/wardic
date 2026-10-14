/**
 * The DOM Environment's Positional keys (CONTEXT.md; ADR-0029, ADR-0036): the transforms, and the
 * box's position and size as CSS names them, `width`, `height`, `top`, `left`, `right` and `bottom`
 * (Motion's `positionalKeys`). Reduced motion Snaps these. Core names only the transforms; these
 * box keys are CSS's, so they're the DOM's. `DomLive` provides the Layer.
 *
 * @module
 */
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import { dashCase } from "./svg.ts"

/** The box's position and size, as CSS properties. */
const BOX_KEYS: ReadonlySet<string> = new Set(["width", "height", "top", "left", "right", "bottom"])

/** A key of the box's position or size, written as a CSS name or in camelCase. */
const isBoxKey: Predicate.Predicate<string> = (key) => BOX_KEYS.has(dashCase(key))

/** Whether reduced motion Snaps `key` in the DOM: a transform, or the box's position or size. */
export const isPositional: Predicate.Predicate<string> = Predicate.or(ReducedMotion.isTransform, isBoxKey)

/** The DOM Environment's `ReducedMotion.PositionalKeys`. */
export const PositionalKeysDomLive: Layer.Layer<ReducedMotion.PositionalKeys> = Layer.succeed(ReducedMotion.PositionalKeys, { isPositional })
