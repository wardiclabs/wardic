/**
 * Solid 1's gesture callbacks (#273, ADR-0047): Motion's `onHoverStart`, `onTap`, `onDragEnd` and the
 * rest, told from the recognizers' events and the drag track's samples. Motion's `(event, info)`: the
 * platform's own event core carried through (`raw`), then the info (`gesture-info.ts`), its point in
 * the viewport. Each is read from the config when it's called, at the event. One that throws is
 * reported (`wardic.gesture: onTap failed`), and the gesture goes on.
 *
 * Which gestures an element runs follows Motion's features (`definitions.ts:5-24` @ `16c6122`): the
 * hover recognizer once `whileHover`, `onHoverStart` or `onHoverEnd` is set, the press recognizer once
 * `whileTap`, `onTap`, `onTapStart` or `onTapCancel` is.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Report from "@wardic/dom/Report"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardConfig } from "./config.ts"
import { dragInfoOf, pointInfoOf } from "./gesture-info.ts"
import type { WardicRuntime } from "./runtime.ts"

/**
 * Whether `config` runs the hover recognizer (Motion's hover feature). Read at every config change of
 * an element that doesn't run it yet: statement `if`s, no array (ADR-0025).
 */
export const wantsHover = (config: WardConfig): boolean => {
  if (Predicate.isNotUndefined(config.whileHover)) return true
  if (Predicate.isNotUndefined(config.onHoverStart)) return true
  return Predicate.isNotUndefined(config.onHoverEnd)
}

/** Whether `config` runs the press recognizer (Motion's tap feature): as {@link wantsHover}. */
export const wantsPress = (config: WardConfig): boolean => {
  if (Predicate.isNotUndefined(config.whileTap)) return true
  if (Predicate.isNotUndefined(config.onTap)) return true
  if (Predicate.isNotUndefined(config.onTapStart)) return true
  return Predicate.isNotUndefined(config.onTapCancel)
}

/** What tells an element's gestures to its config's callbacks. */
export interface GestureCallbacks {
  readonly hovered: (transition: Recognizer.Transition) => void
  readonly pressed: (press: Recognizer.PressEvent) => void
  readonly dragged: (sample: Drag.Sample) => void
  /** The drag's release came to rest on its own. */
  readonly released: () => void
}

/** Each press phase's callback: a press a drag took over has none (Motion tells neither). */
const PRESS_CALLBACK = { start: "onTapStart", tap: "onTap", cancel: "onTapCancel", dragged: undefined } as const

/** Each drag phase's callback, `onDrag` aside. */
const DRAG_CALLBACK = { start: "onDragStart", move: undefined, end: "onDragEnd" } as const

/** An element's callers, reading `config` at each call; `id` names it in a report. */
export const gestureCallbacksOf = (runtime: WardicRuntime, id: string, config: () => WardConfig): GestureCallbacks => {
  /** Call the app's `name`, reported if it throws. */
  const call = <Args extends ReadonlyArray<unknown>>(name: string, callback: ((...args: Args) => void) | undefined, ...args: Args): void => {
    if (Predicate.isUndefined(callback)) return
    try {
      callback(...args)
    } catch (defect) {
      runtime.runFork(Report.failure(`wardic.gesture: ${name} failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ id })))
    }
  }
  return {
    hovered: (transition) => {
      const name = Bool.match(transition.active, { onTrue: () => "onHoverStart" as const, onFalse: () => "onHoverEnd" as const })
      call(name, config()[name], transition.event.raw as PointerEvent, pointInfoOf(transition.event))
    },
    pressed: (press) => {
      const name = PRESS_CALLBACK[press.phase]
      if (Predicate.isUndefined(name)) return
      call(name, config()[name], press.event.raw as PointerEvent, pointInfoOf(press.event))
    },
    dragged: (sample) => {
      const c = config()
      const name = DRAG_CALLBACK[sample.phase]
      const own = UndefinedOr.map(name, (named) => c[named])
      // Motion's `onDrag`: the start and each move (its pan session's `onMove` runs at the start too).
      const moving = sample.phase !== "end"
      // The info is built once, for whichever is set.
      if (Bool.and(Predicate.isUndefined(own), Bool.or(Bool.not(moving), Predicate.isUndefined(c.onDrag)))) return
      const raw = sample.raw as PointerEvent
      const info = dragInfoOf(sample)
      if (Predicate.isNotUndefined(name)) call(name, own, raw, info)
      if (moving) call("onDrag", c.onDrag, raw, info)
    },
    released: () => call("onDragTransitionEnd", config().onDragTransitionEnd),
  }
}
