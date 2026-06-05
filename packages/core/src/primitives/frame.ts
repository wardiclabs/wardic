/**
 * Frame contract — what every primitive emits.
 *
 * A `Frame<V>` is one per-tick emission of a primitive: the current value plus
 * whether motion has settled (the final, inclusive frame is `done: true`).
 *
 * A `PhysicsFrame` additionally carries `velocity`; only physics primitives
 * (`spring`, `decay`, `chase`) emit it, and the optional `velocity` is the
 * discriminator a type guard narrows on. See `CONTEXT.md` and
 * `docs/adr/0001-core-stream-contract.md` for the language and rationale.
 */

export interface Frame<V> {
  readonly value: V
  readonly done: boolean
}

/**
 * Frame emitted by physics primitives — extends `Frame<number>` with the
 * instantaneous `velocity` needed to preserve momentum across a retarget.
 */
export type PhysicsFrame = Frame<number> & { readonly velocity: number }

/**
 * Multi-key analog of {@link PhysicsFrame} — the frame `springValues` emits.
 *
 * Extends `Frame<Record<string, number>>` with a per-key `velocity` map keyed
 * identically to `value`, carrying each spring's instantaneous velocity. This
 * is physics-only (definite multi forms like `animateValues` emit a plain
 * `Frame`), and it's what makes a velocity-preserving retarget possible: a
 * caller can seed a fresh `springValues` from a prior frame's `value` AND
 * `velocity` so momentum is continuous rather than reset to 0.
 */
export interface MultiPhysicsFrame extends Frame<Record<string, number>> {
  readonly velocity: Record<string, number>
}

/**
 * Type guard narrowing a numeric frame to a `PhysicsFrame` via the `velocity`
 * discriminator. Definite primitives never carry velocity, so this lets the
 * binding layer cache a snapshot with the right shape without sniffing the
 * source primitive.
 */
export const isPhysicsFrame = (frame: Frame<number>): frame is PhysicsFrame =>
  typeof (frame as PhysicsFrame).velocity === "number"

/**
 * Maximum delta-time (seconds) any primitive will simulate in one step.
 *
 * Long frame stalls (tab switches, slow first paints, debugger pauses) can
 * produce `dt` values measured in seconds — large enough to teleport a spring
 * across its rest thresholds or blow up a decay integration. Clamping at the
 * `fromClock` tick-consumption point keeps every primitive honest without each
 * stepper needing to defend itself.
 *
 * 500ms is permissive by design: it accommodates the synthetic frame samples
 * our unit tests use (which push the engine with 0.25s–0.5s deltas) while
 * still capping the multi-second deltas a tab-switch can produce. Live
 * 60fps frames (~16ms) are unaffected.
 */
export const MAX_DT = 0.5
