/**
 * The `DragActivity` module. **Drag activity** (ADR-0019, decision 3b): how many drags are active on the page,
 * and the **Drag claims** they hold (ADR-0019, *Amendment (#29)*). The `drag` recognizer counts in it once
 * past its threshold and counts off at its end or when interrupted; while it is non-zero, no hover and no
 * press starts (Motion's `isDragging` flags, `motion-dom/src/gestures/drag/state/is-active.ts` @ `16c6122`).
 *
 * A drag that claims takes its target's Drag claim on the axes it moves on, each held on its own (Motion's
 * `setDragLock`, `motion-dom/src/gestures/drag/state/set-active.ts` @ `16c6122`). A claim on an axis another
 * target holds is refused; claims by one target share its hold, which ends at the last one's release.
 *
 * It is a `Context.Reference`, so it needs no Layer and stays out of the recognizers'
 * requirements: by default every runtime shares one instance, page-wide like Motion's.
 * A runtime can provide its own (the test Environment does, so tests stay isolated).
 * The API is synchronous so the hover and press folds read it inline.
 *
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import { constVoid } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import type * as Drag from "./Drag.ts"

/** The Drag activity counter and the page's Drag claims. */
export interface Shape {
  /**
   * Take `target`'s Drag claim on `axis` (both axes for `"xy"`) and count one more active drag. `None`
   * when another target holds one of those axes: the drag is refused, and nothing is counted or claimed.
   * Otherwise its release, which counts it off and gives up its axes once, however often it is called.
   */
  readonly claim: (target: unknown, axis: Drag.Axis) => Option.Option<() => void>
  /** Count one more active drag that claims no axis (`claim: false`). Returns its release, which counts it off once. */
  readonly count: () => () => void
  /** Whether any drag is active. */
  readonly isDragActive: () => boolean
}

/** One axis's holder: the target that claimed it, and how many of its claims hold it. */
interface Holder {
  readonly target: unknown
  claims: number
}

const BOTH: ReadonlyArray<"x" | "y"> = ["x", "y"]
const ONLY_X: ReadonlyArray<"x" | "y"> = ["x"]
const ONLY_Y: ReadonlyArray<"x" | "y"> = ["y"]

/** The axes a drag on `axis` moves on. */
const axesOf = (axis: Drag.Axis): ReadonlyArray<"x" | "y"> =>
  Match.value(axis).pipe(
    Match.when("x", () => ONLY_X),
    Match.when("y", () => ONLY_Y),
    Match.orElse(() => BOTH),
  )

/** A fresh Drag activity, with no drag active and no axis claimed. */
export const make = (): Shape => {
  const active = MutableRef.make(0)
  const holders = { x: MutableRef.make(Option.none<Holder>()), y: MutableRef.make(Option.none<Holder>()) }

  /** Count one more active drag; `giveUp` runs at its release, once. */
  const countWith = (giveUp: () => void): (() => void) => {
    MutableRef.increment(active)
    const released = MutableRef.make(false)
    return () => {
      // Counts off once: only the first call flips `released`.
      if (MutableRef.compareAndSet(released, false, true)) {
        MutableRef.decrement(active)
        giveUp()
      }
    }
  }

  /** Whether `target` may claim `axis`: no one holds it, or `target` itself does. */
  const isFreeFor = (target: unknown) => (axis: "x" | "y"): boolean =>
    Option.match(MutableRef.get(holders[axis]), { onNone: () => true, onSome: (holder) => holder.target === target })

  const hold = (target: unknown) => (axis: "x" | "y"): void =>
    Option.match(MutableRef.get(holders[axis]), {
      onNone: () => {
        MutableRef.set(holders[axis], Option.some<Holder>({ target, claims: 1 }))
      },
      onSome: (holder) => {
        holder.claims++
      },
    })

  const unhold = (axis: "x" | "y"): void =>
    Option.match(MutableRef.get(holders[axis]), {
      onNone: constVoid,
      onSome: (holder) => {
        holder.claims--
        if (holder.claims === 0) MutableRef.set(holders[axis], Option.none())
      },
    })

  return {
    claim: (target, axis) => {
      const axes = axesOf(axis)
      return Bool.match(Arr.every(axes, isFreeFor(target)), {
        onFalse: () => Option.none(),
        onTrue: () => {
          Arr.forEach(axes, hold(target))
          return Option.some(countWith(() => Arr.forEach(axes, unhold)))
        },
      })
    },
    count: () => countWith(constVoid),
    isDragActive: () => MutableRef.get(active) > 0,
  }
}

/** The runtime's Drag activity: one shared default instance unless a runtime provides its own. */
export const DragActivity: Context.Reference<Shape> = Context.Reference<Shape>("@wardic/DragActivity", {
  defaultValue: make,
})
