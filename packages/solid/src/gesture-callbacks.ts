/**
 * Solid 1's gesture callbacks (#273, ADR-0047): Motion's `onHoverStart`, `onTap`, `onDragEnd` and the
 * rest, told from the recognizers' events and the drag track's samples. Motion's `(event, info)`: the
 * platform's own event core carried through (`raw`), then the info (dom's `unstable/GestureInfo`), its point in
 * the viewport. Each is read from the config when it's called, at the event. One that throws is
 * reported (`wardic.gesture: onTap failed`), and the gesture goes on.
 *
 * Which gestures an element runs follows Motion's features (`definitions.ts:5-24` @ `16c6122`): the
 * hover recognizer once `whileHover`, `onHoverStart` or `onHoverEnd` is set, the press recognizer once
 * `whileTap`, `onTap`, `onTapStart` or `onTapCancel` is, the pan recognizer once a pan callback is.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Report from "@wardic/dom/Report"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import * as GestureInfo from "@wardic/dom/unstable/GestureInfo"
import type { WardicRuntime } from "./runtime.ts"

// The wanted-gesture predicates and the keys they read are dom's (#793): every binding's gesture start reads them.
export { GESTURE_KEYS, wantsFocus, wantsHover, wantsInView, wantsPan, wantsPress } from "@wardic/dom/unstable/GestureFeatures"

/** Motion's `viewport` as core's in-view options (#273): its root read now, when the recognizer starts. dom's, over Solid's accessor root. */
export const inViewOptionsOf = (viewport: WardConfig.WardicViewport | undefined): Recognizer.InViewOptions => GestureFeatures.inViewOptionsOf(viewport)

/** What tells an element's gestures to its config's callbacks. */
export interface GestureCallbacks {
  readonly hovered: (edge: Recognizer.Edge) => void
  readonly pressed: (press: Recognizer.PressEvent, element: Element) => void
  readonly dragged: (sample: Drag.Sample) => void
  /** The drag's release came to rest on its own. */
  readonly released: () => void
  readonly panned: (sample: DragRecognizer.PanSample) => void
  /** An in-view edge: `onViewportEnter` or `onViewportLeave`, with the platform's entry. */
  readonly viewed: (edge: Recognizer.ViewEdge) => void
}

/** A drag's or a pan's start or end callback. */
type MovementCallback = "onDragStart" | "onDragEnd" | "onPanStart" | "onPanEnd"

/** An element's callers, reading `config` at each call; `id` names it in a report. */
export const gestureCallbacksOf = (runtime: WardicRuntime, id: string, config: () => WardConfig.WardConfig): GestureCallbacks => {
  // The guard around the app's callbacks (#257 item 4; dom's, for both bindings): a throw reported by
  // name, a per-move run of throws at its first.
  const guard = GestureFeatures.callbackGuard((name, defect) => {
    runtime.runFork(Report.failure(`wardic.gesture: ${name} failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ id })))
  })
  /** Call the app's `name`, reported if it throws. */
  const call = <Args extends ReadonlyArray<unknown>>(name: string, callback: ((...args: Args) => void) | undefined, ...args: Args): void => {
    if (Predicate.isUndefined(callback)) return
    guard.once(name, () => callback(...args))
  }
  /** Call `onDrag` or `onPan`, at every move: a run of throws is reported at its first. */
  const callPerMove = <Args extends ReadonlyArray<unknown>>(name: string, callback: ((...args: Args) => void) | undefined, ...args: Args): void => {
    if (Predicate.isUndefined(callback)) return
    guard.perMove(name, () => callback(...args))
  }
  /**
   * A drag's or a pan's sample, past a pan's session's start: its start's or its end's callback
   * (`named`), then `every`, which hears its start and each move (Motion's pan session runs `onMove`
   * at the start too). The info is built once, for whichever is set.
   */
  const moved = (named: MovementCallback | undefined, every: "onDrag" | "onPan", sample: Drag.Sample): void => {
    const c = config()
    const own = UndefinedOr.map(named, (key) => c[key])
    const moving = sample.phase !== "end"
    const each = c[every]
    if (Bool.and(Predicate.isUndefined(own), Bool.or(Bool.not(moving), Predicate.isUndefined(each)))) return
    const raw = sample.raw as PointerEvent
    const info = GestureInfo.dragInfoOf(sample)
    if (Predicate.isNotUndefined(named)) call(named, own, raw, info)
    if (moving) callPerMove(every, each, raw, info)
  }
  return {
    hovered: (edge) => {
      const name = Bool.match(edge.active, { onTrue: () => "onHoverStart" as const, onFalse: () => "onHoverEnd" as const })
      call(name, config()[name], edge.event.raw as PointerEvent, GestureInfo.pointInfoOf(edge.event))
    },
    pressed: (press, element) => {
      const name = GestureFeatures.PRESS_CALLBACK[press.phase]
      if (Predicate.isUndefined(name)) return
      call(name, config()[name], press.event.raw as GestureInfo.WardicPressEvent, GestureInfo.pressInfoOf(press, element))
    },
    dragged: (sample) => {
      // A drag its controls cancelled (#431) ends untold, as Motion's `cancel` tells no `onDragEnd`.
      if (sample.cancelled === true) return
      // A direction-locked drag's lock, at its start, before `onDragStart` (Motion's order).
      if (sample.phase === "start") {
        const c = config()
        if (c.dragDirectionLock === true) call("onDirectionLock", c.onDirectionLock, sample.axis as "x" | "y")
      }
      moved(GestureFeatures.DRAG_CALLBACK[sample.phase], "onDrag", sample)
    },
    released: () => call("onDragTransitionEnd", config().onDragTransitionEnd),
    panned: (sample) => {
      // Its session's start, at the down: Motion's `onPanSessionStart`, with the point only.
      if (sample.phase === "session") {
        call("onPanSessionStart", config().onPanSessionStart, sample.raw as PointerEvent, GestureInfo.pointOfSample(sample))
        return
      }
      moved(GestureFeatures.PAN_CALLBACK[sample.phase], "onPan", sample as Drag.Sample)
    },
    viewed: (edge) => {
      const name = Bool.match(edge.active, { onTrue: () => "onViewportEnter" as const, onFalse: () => "onViewportLeave" as const })
      call(name, config()[name], edge.raw as IntersectionObserverEntry)
    },
  }
}
