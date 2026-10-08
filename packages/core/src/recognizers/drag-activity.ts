/**
 * **Drag activity** (ADR-0019, decision 3b): how many drags are active on the page.
 * The `drag` recognizer claims it once past its threshold and releases it at its end or
 * when interrupted; while it is non-zero, no hover and no press starts (Motion's
 * `isDragging` flags, `motion-dom/src/gestures/drag/state/is-active.ts` @ `16c6122`).
 * The nested-drag lock (#29) grows out of the claim: it will refuse one.
 *
 * It is a `Context.Reference`, so it needs no Layer and stays out of the recognizers'
 * requirements: by default every runtime shares one instance, page-wide like Motion's.
 * A runtime can provide its own (the test Environment does, so tests stay isolated).
 * The API is synchronous so the hover and press folds read it inline.
 *
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect.
 */
import * as Context from "effect/Context"
import * as MutableRef from "effect/MutableRef"

/** The Drag activity counter. */
export interface DragActivityShape {
  /** Count one more active drag. Returns its release, which counts it off once however often it is called. */
  readonly claim: () => () => void
  /** Whether any drag is active. */
  readonly isDragActive: () => boolean
}

/** A fresh Drag activity counter, with no drag active. */
export const makeDragActivity = (): DragActivityShape => {
  const active = MutableRef.make(0)
  return {
    claim: () => {
      MutableRef.increment(active)
      const released = MutableRef.make(false)
      return () => {
        // Counts off once: only the first call flips `released`.
        if (MutableRef.compareAndSet(released, false, true)) MutableRef.decrement(active)
      }
    },
    isDragActive: () => MutableRef.get(active) > 0,
  }
}

/** The runtime's Drag activity: one shared default instance unless a runtime provides its own. */
export const DragActivity: Context.Reference<DragActivityShape> = Context.Reference<DragActivityShape>(
  "@wardic/DragActivity",
  { defaultValue: makeDragActivity },
)
