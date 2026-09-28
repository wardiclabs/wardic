import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type { Atom } from "effect/unstable/reactivity"

/**
 * Time source for the engine.
 *
 * Exposes the current absolute time (reference-only — animations consume `dt`,
 * not absolute time), the most recent delta, and a stream of `dt` values that
 * primitives subscribe to. Environments drive it by calling `tick`.
 *
 * Cold start contract (ADR-0017), which `makeRefreshFrameClock` implements for
 * every Environment driven by Refresh frames: a subscription that starts an idle
 * Clock receives a Priming tick with `dt = NOMINAL_DT` at the end of its task,
 * before the first Refresh frame; `dt` stays nominal until two Refresh frame
 * timestamps exist; no tick depends on the Effect scheduler; and the Clock goes
 * idle only at the first Refresh frame that finds no subscriber, so an unsubscribe
 * followed by a subscribe before it (a retarget) is a warm start.
 */
export class Clock extends Context.Service<Clock, {
  /** Current absolute time. Reference-only; prefer `dt`. */
  readonly time: Atom.Atom<number>
  /** Most recent delta time, in seconds. */
  readonly dt: Atom.Atom<number>
  /** Stream of `dt` values, one per frame. */
  readonly ticks: Stream.Stream<number>
  /** Advance the clock to absolute time `t` (environments call this). */
  readonly tick: (t: number) => Effect.Effect<void>
}>()("@wardic/Clock") {}
