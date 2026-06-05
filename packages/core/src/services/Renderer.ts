import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"

/**
 * Output of `Renderer.project` — the environment-specific representation of a
 * frame's values, ready to be written by `Renderer.commit`. Structurally an
 * opaque `Record<string, unknown>` so each environment (DOM, canvas, native)
 * is free to encode grouped fields (e.g. an aggregated `transform` string)
 * without leaking that shape into engine code.
 */
export type Patch = Record<string, unknown>

/**
 * Output sink. Writes computed animation values onto whatever the environment
 * renders to — a DOM element's style, a canvas context, a native view, etc.
 *
 * Split into two halves (see ADR-0002):
 *   - `project` — pure, synchronous: translates engine values into the
 *     environment's representation (`Patch`). Side-effect-free; reused by the
 *     reactive Solid path so DOM grouping/unit logic isn't duplicated.
 *   - `commit` — imperative: writes a `Patch` to `target`. Used only by the
 *     imperative path (`applyTo`, `createAnimate`, `use:ward`); the Solid
 *     declarative surface skips it entirely.
 *
 * `target` is environment-defined and opaque to the engine; the DOM renderer
 * treats it as an `HTMLElement`, a canvas renderer as a draw context, and so on.
 */
export class Renderer extends Context.Service<Renderer, {
  /** Pure: translate engine values into the environment's patch shape. */
  readonly project: (values: Record<string, unknown>) => Patch
  /** Imperative: write a projected patch onto `target`. */
  readonly commit: <T>(target: T, patch: Patch) => Effect.Effect<void>
}>()("@wardic/Renderer") {}
