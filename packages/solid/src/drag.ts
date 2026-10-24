/**
 * `runDragTrack` (ADR-0004): the Solid 1 binding's drag track, the shared one (`drag-track.ts`)
 * with its one fiber run by `runScoped`, so the caller's `onCleanup` interrupts it.
 */
import { DEFAULT_DRAG_ELASTIC, dragTransitionOf } from "./drag-transition.ts"
import { driveDragTrack, type DragTrack, type DragTrackOptions } from "./drag-track.ts"
import { runScoped } from "./provider.tsx"
import type { WardicRuntime } from "./runtime.ts"

export { DEFAULT_DRAG_ELASTIC, dragTransitionOf }
export type { DragSnapshot, DragTrack, DragTrackConfig } from "./drag-track.ts"

/** Options for {@link runDragTrack}: the shared track's, on a provider runtime. */
export interface RunDragTrackOptions extends Omit<DragTrackOptions, "run"> {
  /** The provider runtime the track's single fiber is forked on. */
  readonly runtime: WardicRuntime
}

/**
 * Run the drag track on `opts.element` (`drag-track.ts`): one fiber via `runScoped`, so the
 * caller's `onCleanup` interrupts it (dropping the Shared-source ref-count and stopping any
 * in-flight release). Must be called within a Solid owner. Its hold on `x`/`y` goes to the spine (#340).
 */
export const runDragTrack = (opts: RunDragTrackOptions): DragTrack => driveDragTrack({ ...opts, run: (track) => void runScoped(opts.runtime, track) })
