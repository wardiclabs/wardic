/**
 * `runDragTrack` (ADR-0004): the Solid 1 binding's drag track, the shared one (`drag-track.ts`), its
 * watches run by `runWatch` in a Scope the caller's owner closes, and its responses forked on the
 * provider runtime (#379).
 */
import { DEFAULT_DRAG_ELASTIC, dragTransitionOf } from "./drag-transition.ts"
import { driveDragTrack, type DragTrack, type DragTrackOptions } from "./drag-track.ts"
import { runWatch } from "./provider.tsx"
import type { WardicRuntime } from "./runtime.ts"

export { DEFAULT_DRAG_ELASTIC, dragTransitionOf }
export type { DragSnapshot, DragTrack, DragTrackConfig } from "./drag-track.ts"

/** Options for {@link runDragTrack}: the shared track's, on a provider runtime. */
export interface RunDragTrackOptions extends Omit<DragTrackOptions, "watch" | "fork"> {
  /** The provider runtime the track's watches and responses run on. */
  readonly runtime: WardicRuntime
}

/**
 * Run the drag track on `opts.element` (`drag-track.ts`): its watches in a Scope of their own via
 * `runWatch`, with no fiber at rest, which the caller's owner closes (stopping the watches and any
 * in-flight release, #379). Must be called within a Solid owner. Its hold on `x`/`y` goes to the
 * spine (#340).
 */
export const runDragTrack = (opts: RunDragTrackOptions): DragTrack =>
  driveDragTrack({
    ...opts,
    watch: (track) => runWatch(opts.runtime, track),
    fork: (response) => void opts.runtime.runFork(response),
  })
