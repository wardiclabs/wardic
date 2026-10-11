/**
 * The `Frame` module: what every Primitive emits, one per tick (CONTEXT.md's Frame). A plain
 * shape, so it has no prototype (ADR-0028, decision 1): a step allocates one every tick, or
 * rewrites one per run in place, as `springValues`' does (ADR-0030, decision 11). A sink that
 * keeps a Frame copies it.
 *
 * A `Frame<V>` is the current value plus whether motion has settled (the final, inclusive
 * Frame is `done: true`). A `Physics` Frame also carries `velocity`: only the physics
 * Primitives (`spring`, `decay`, `chase`) emit it, and the `velocity` field is what `isPhysics`
 * narrows on. See `CONTEXT.md` and `docs/adr/0001-core-stream-contract.md`.
 */
import * as Predicate from "effect/Predicate"

export interface Frame<V> {
  readonly value: V
  readonly done: boolean
}

/**
 * Frame emitted by physics primitives — extends `Frame<number>` with the
 * instantaneous `velocity` needed to preserve momentum across a retarget.
 */
export type Physics = Frame<number> & { readonly velocity: number }

/**
 * Multi-key analog of {@link Physics} — the frame `springValues` emits.
 *
 * Extends `Frame<Record<string, number>>` with a per-key `velocity` map keyed
 * identically to `value`, carrying each spring's instantaneous velocity. This
 * is physics-only (definite multi forms like `animateValues` emit a plain
 * `Frame`), and it's what makes a velocity-preserving retarget possible: a
 * caller can seed a fresh `springValues` from a prior frame's `value` AND
 * `velocity` so momentum is continuous rather than reset to 0. `springValues`
 * rewrites its Frame each tick, so a caller that seeds from it after that
 * tick copies both records first.
 */
export interface MultiPhysics extends Frame<Record<string, number>> {
  readonly velocity: Record<string, number>
}

/**
 * Type guard narrowing a numeric frame to a `Physics` Frame via the `velocity`
 * discriminator. Definite primitives never carry velocity, so this lets the
 * binding layer cache a snapshot with the right shape without sniffing the
 * source primitive.
 */
export const isPhysics = (frame: Frame<number>): frame is Physics => Predicate.isNumber((frame as Physics).velocity)
