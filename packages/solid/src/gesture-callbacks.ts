/**
 * Solid 1's gesture callbacks (#273, ADR-0047): Motion's `onHoverStart`, `onTap`, `onDragEnd` and the
 * rest, told from the recognizers' events and the drag track's samples by dom's gesture teller
 * (`unstable/GestureFeatures`, #793): Motion's `(event, info)`, the platform's own event core carried
 * through (`raw`), then the info, its point in the viewport. Each is read from the config when it's
 * called, at the event, and called as the function it is. One that throws is reported
 * (`wardic.gesture: onTap failed`), and the gesture goes on.
 *
 * Which gestures an element runs follows Motion's features (`definitions.ts:5-24` @ `16c6122`): the
 * hover recognizer once `whileHover`, `onHoverStart` or `onHoverEnd` is set, the press recognizer once
 * `whileTap`, `onTap`, `onTapStart` or `onTapCancel` is, the pan recognizer once a pan callback is.
 *
 * @module
 */
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Report from "@wardic/dom/Report"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import type { WardicRuntime } from "./runtime.ts"

// The wanted-gesture predicates and the keys they read are dom's (#793): every binding's gesture start reads them.
export { GESTURE_KEYS, wantsFocus, wantsHover, wantsInView, wantsPan, wantsPress } from "@wardic/dom/unstable/GestureFeatures"

/** Motion's `viewport` as core's in-view options (#273): its root read now, when the recognizer starts. dom's, over Solid's accessor root. */
export const inViewOptionsOf = (viewport: WardConfig.WardicViewport | undefined): Recognizer.InViewOptions => GestureFeatures.inViewOptionsOf(viewport)

/** What tells an element's gestures to its config's callbacks: dom's teller. */
export type GestureCallbacks = GestureFeatures.GestureTeller

/** A callback of Solid 1's config: a function of the event and the info. */
type Called = (...args: ReadonlyArray<unknown>) => void

/** An element's callers, reading `config` at each call; `id` names it in a report. */
export const gestureCallbacksOf = (runtime: WardicRuntime, id: string, config: () => WardConfig.WardConfig): GestureCallbacks =>
  GestureFeatures.gestureTellerOf({
    config,
    invoke: (handler, args) => (handler as Called)(...args),
    report: (name, defect) => {
      runtime.runFork(Report.failure(`wardic.gesture: ${name} failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ id })))
    },
  })
