/**
 * Frames: what an animation gives each tick, its value and whether it has settled; its last Frame is
 * `done: true`. A spring's and a decay's carry their `velocity` too (`Physics`), so an animation that
 * replaces one can start at its speed. A Frame handed to you can be rewritten at the next tick: copy
 * one you keep.
 *
 * @example
 * import * as Frame from "@wardic/core/Frame"
 *
 * const sink = (frame: Frame.Frame<number>) => {
 *   draw(frame.value)
 *   if (Frame.isPhysics(frame)) speed = frame.velocity
 * }
 */
// CONTEXT.md's Frame; docs/adr/0001-core-stream-contract.md. A plain shape, so it has no prototype
// (ADR-0028, decision 1): a step allocates one every tick, or rewrites one per run in place, as
// `springValues`' does (ADR-0030, decision 11). Only the physics Primitives (`spring`, `decay`, `chase`)
// emit `velocity`, the field `isPhysics` narrows on.
import * as Predicate from "effect/Predicate"

/** One tick of an animation: its value, and whether it has settled. */
export interface Frame<V> {
  /** The value this tick. */
  readonly value: V
  /** Whether it has settled: `true` on its last Frame. */
  readonly done: boolean
}

/** A spring's or a decay's Frame: a number, and its velocity now, so an animation that replaces it keeps its speed. */
export type Physics = Frame<number> & { readonly velocity: number }

/**
 * `Machine.springValues`' Frame: each key's value and each key's velocity. A spring that replaces it can
 * start from both, so its motion carries on. It's rewritten each tick: copy both before you keep them.
 */
export interface MultiPhysics extends Frame<Record<string, number>> {
  readonly velocity: Record<string, number>
}

/** Whether `frame` carries a velocity: a spring's, a decay's. */
export const isPhysics = (frame: Frame<number>): frame is Physics => Predicate.isNumber((frame as Physics).velocity)
