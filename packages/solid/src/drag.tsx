/**
 * `runDragTrack` (ADR-0004): the Solid 1 binding's drag track, the shared one (`drag-track.ts`), its
 * watches run by `runWatch` in a Scope the caller's owner closes, and its responses forked on the
 * provider runtime (#379). The track is the `drag` Feature's (#511): `runDragTrack` brings it.
 */
import * as InputSource from "@wardic/core/InputSource"
import * as Effect from "effect/Effect"
import { DEFAULT_DRAG_ELASTIC, dragTransitionOf } from "./drag-transition.ts"
import { driveDragTrack, type DragTrack, type DragTrackOptions } from "./drag-track.ts"
import type { Feature } from "./feature.ts"
import { drag } from "./features/drag.ts"
import { inputIn } from "./gesture-features.ts"
import { runWatch, useBrought } from "./provider.tsx"
import type { WardicRuntime } from "./runtime.ts"
import { type DragGesture } from "./features/keys.ts"

export { DEFAULT_DRAG_ELASTIC, dragTransitionOf }
export type { DragSnapshot, DragTrack, DragTrackConfig } from "./drag-track.ts"

/** `runDragTrack`'s options: the element, its drag config, the spine's snapshot and callbacks, and the provider's runtime. */
export interface RunDragTrackOptions extends Omit<DragTrackOptions, "watch" | "fork"> {
  /** The provider runtime the track's watches and responses run on. */
  readonly runtime: WardicRuntime
}

/**
 * Runs a drag on `opts.element` as a Wardic element's own drag runs: its gesture, constraints, elastic,
 * release and drag claims, writing `x` and `y` through the element's snapshot. For an element of your
 * own built on Wardic's drag. Stopped as the current owner is cleaned up. Brings the `drag` Feature.
 * Solid 1 only.
 *
 * @see https://wardic.dev/reference/solid/advanced/run-drag-track
 */
// `drag-track.ts`, ADR-0004: its watches in a Scope of their own via `runWatch`, no fiber at rest, closed
// by the caller's owner, which stops the watches and an in-flight release (#379). Its hold on x/y goes
// to the spine (#340).
export const runDragTrack = (opts: RunDragTrackOptions): DragTrack => {
  // The gestures' input, read as the track first watches, on the client: a server render runs no watch.
  const services = useBrought(BRINGS)
  const given = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, InputSource.InputSource>> =>
    Effect.provideService(effect, InputSource.InputSource, inputIn(services()))
  return driveDragTrack({
    ...opts,
    watch: (track) => runWatch(opts.runtime, (onDefect) => given(track(onDefect))),
    fork: (response) => void opts.runtime.runFork(given(response)),
  })
}

/** What {@link runDragTrack} brings (ADR-0067 decision 12): the `drag` Feature, whatever its section has (#511). */
const BRINGS: ReadonlyArray<Feature> = [drag]

/** {@link runDragTrack} through `drive`: an element's section's `drag` Feature's (#511), where `runDragTrack` brings it. Internal. */
export const runDragTrackWith = (drive: DragGesture["Service"]["drive"], opts: RunDragTrackOptions): DragTrack =>
  drive({
    ...opts,
    watch: (track) => runWatch(opts.runtime, track),
    fork: (response) => void opts.runtime.runFork(response),
  })
