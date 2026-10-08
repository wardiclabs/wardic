import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Schema from "effect/Schema"

/**
 * A value kind the registry can blend (ADR-0026): its Schema codec, and how two decoded values
 * of it blend.
 *
 * - **`codec`** decodes an endpoint of the kind. An endpoint it decodes is this entry's, and one
 *   it rejects isn't: decoding is matching. The registry decodes once, when a stream is built
 *   (`resolve`), never per frame.
 * - **`blend`** takes two decoded endpoints, once, and returns the closure the frame calls,
 *   which blends and then encodes with the codec's plain encode function, never
 *   `Schema.encode`. The pair's own work (comparing two structures, settling a unit) happens
 *   here, once. `None` when the pair can't blend: a Discrete pair (CONTEXT.md), which the
 *   registry switches at the first frame and warns about.
 *
 * The built-in entries (number, array, color via culori, unit string, complex value) are
 * registered when the Environment is set up, and consumers can register their own.
 */
export interface InterpolatorEntry<Decoded, Encoded> {
  /** Unique name for the value kind, e.g. "number", "color(rgb)", "unit". */
  readonly name: string
  /** The value kind: decodes an endpoint of it, and encodes a blended value back. */
  readonly codec: Schema.Codec<Decoded, Encoded>
  /** Two decoded endpoints' blend: the closure the frame calls with `t`, or `None`. */
  readonly blend: (from: Decoded, to: Decoded) => Option.Option<(t: number) => Encoded>
}

/**
 * Registry of value-kind interpolators. The engine resolves the interpolation
 * strategy for a value through this service rather than hard-coding type checks,
 * so new value kinds are added by registering an entry — no engine changes.
 *
 * `resolve` is the hot-path entry point: it decodes a `from`/`to` pair once, picks
 * the entry that decodes it, and returns a pure `(t) => From | To`. `interpolate`
 * is sugar that resolves and applies in one step for callers that already have `t`;
 * it decodes on every call.
 *
 * The signature is intentionally `<From, To>` rather than `<T>` so mixed-type
 * pairs (`0` → `"10px"`) type-check cleanly — pair-aware selection in the
 * registry picks an interpolator that can produce one of the input value types
 * (often the string side, after coercion), which `From | To` honestly reflects.
 */
export class InterpolatorRegistry extends Context.Service<InterpolatorRegistry, {
  readonly register: <Decoded, Encoded>(entry: InterpolatorEntry<Decoded, Encoded>) => Effect.Effect<void>
  readonly resolve: <From, To>(from: From, to: To) => Effect.Effect<(t: number) => From | To>
  readonly interpolate: <From, To>(from: From, to: To, t: number) => Effect.Effect<From | To>
}>()("@wardic/InterpolatorRegistry") {}
