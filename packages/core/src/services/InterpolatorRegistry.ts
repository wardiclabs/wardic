import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"

/**
 * A pluggable interpolator for one value type (number, color, unit-string, …).
 *
 * `match` lets the registry pick the right entry for a value at runtime; the
 * built-in entries (number, array, color via culori, unit-string) register on
 * environment setup, and consumers can register their own.
 */
export interface InterpolatorEntry<T> {
  /** Unique name for the value type, e.g. "number", "color", "px". */
  readonly name: string
  /** Whether this entry can interpolate the given value. */
  readonly match: (value: unknown) => boolean
  /** Interpolate `from` → `to` at `t` in [0, 1]. */
  readonly interpolate: (from: T, to: T, t: number) => T
}

/**
 * Registry of value-type interpolators. The engine resolves the interpolation
 * strategy for a value through this service rather than hard-coding type checks,
 * so new value types are added by registering an entry — no engine changes.
 *
 * `resolve` is the hot-path entry point: it selects an entry once for a
 * `from`/`to` pair and returns a pure `(t) => From | To`. `interpolate` is
 * sugar that resolves and applies in one step for callers that already have `t`.
 *
 * The signature is intentionally `<From, To>` rather than `<T>` so mixed-type
 * pairs (`0` → `"10px"`) type-check cleanly — pair-aware selection in the
 * registry picks an interpolator that can produce one of the input value types
 * (often the string side, after coercion), which `From | To` honestly reflects.
 */
export class InterpolatorRegistry extends Context.Service<InterpolatorRegistry, {
  readonly register: <T>(entry: InterpolatorEntry<T>) => Effect.Effect<void>
  readonly resolve: <From, To>(from: From, to: To) => Effect.Effect<(t: number) => From | To>
  readonly interpolate: <From, To>(from: From, to: To, t: number) => Effect.Effect<From | To>
}>()("@wardic/InterpolatorRegistry") {}
