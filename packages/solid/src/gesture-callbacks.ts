/**
 * Solid 1's gesture callbacks (#273, ADR-0047): Motion's `onHoverStart`, `onTap`, `onDragEnd` and the
 * rest, told from the recognizers' events and the drag track's samples. Motion's `(event, info)`: the
 * platform's own event core carried through (`raw`), then the info (`gesture-info.ts`), its point in
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
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Report from "@wardic/dom/Report"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardConfig, WardicViewport } from "./config.ts"
import { dragInfoOf, pointInfoOf, pointOfSample, pressInfoOf, type WardicPressEvent } from "./gesture-info.ts"
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

/** Whether `config` runs the pan recognizer (Motion's pan feature, #273): as {@link wantsHover}. */
export const wantsPan = (config: WardConfig): boolean => {
  if (Predicate.isNotUndefined(config.onPan)) return true
  if (Predicate.isNotUndefined(config.onPanStart)) return true
  if (Predicate.isNotUndefined(config.onPanSessionStart)) return true
  return Predicate.isNotUndefined(config.onPanEnd)
}

/** Whether `config` runs the in-view recognizer (Motion's inView feature, #273): `whileInView` or a viewport callback. */
export const wantsInView = (config: WardConfig): boolean => {
  if (Predicate.isNotUndefined(config.whileInView)) return true
  if (Predicate.isNotUndefined(config.onViewportEnter)) return true
  return Predicate.isNotUndefined(config.onViewportLeave)
}

/** Whether `config` runs the focus recognizer (Motion's focus feature, #273): `whileFocus`. */
export const wantsFocus = (config: WardConfig): boolean => Predicate.isNotUndefined(config.whileFocus)

/** Motion's `amount` as a share of the element: `"some"` any of it, `"all"` all of it. */
const amountOf = (amount: "some" | "all" | number | undefined): number | undefined =>
  Match.value(amount).pipe(
    Match.when("some", () => 0),
    Match.when("all", () => 1),
    Match.orElse((share) => share),
  )

/** Motion's `viewport` as core's in-view options (#273): its root read now, when the recognizer starts. */
export const inViewOptionsOf = (viewport: WardicViewport | undefined): Recognizer.InViewOptions =>
  UndefinedOr.match(viewport, {
    onUndefined: () => ({}),
    onDefined: (v) => ({
      once: v.once,
      margin: v.margin,
      amount: amountOf(v.amount),
      ...UndefinedOr.match(v.root, { onUndefined: () => ({}), onDefined: (root) => ({ root: root() }) }),
    }),
  })

/** What tells an element's gestures to its config's callbacks. */
export interface GestureCallbacks {
  readonly hovered: (transition: Recognizer.Transition) => void
  readonly pressed: (press: Recognizer.PressEvent, element: Element) => void
  readonly dragged: (sample: Drag.Sample) => void
  /** The drag's release came to rest on its own. */
  readonly released: () => void
  readonly panned: (sample: Recognizer.PanSample) => void
  /** An in-view transition: `onViewportEnter` or `onViewportLeave`, with the platform's entry. */
  readonly viewed: (transition: Recognizer.ViewTransition) => void
}

/** Each press phase's callback: a press a drag took over has none (Motion tells neither). */
const PRESS_CALLBACK = { start: "onTapStart", tap: "onTap", cancel: "onTapCancel", dragged: undefined } as const

/** Each drag phase's callback, `onDrag` aside. */
const DRAG_CALLBACK = { start: "onDragStart", move: undefined, end: "onDragEnd" } as const

/** Each pan phase's callback past its session's start, `onPan` aside. */
const PAN_CALLBACK = { start: "onPanStart", move: undefined, end: "onPanEnd" } as const

/** A drag's or a pan's start or end callback. */
type MovementCallback = "onDragStart" | "onDragEnd" | "onPanStart" | "onPanEnd"

/** An element's callers, reading `config` at each call; `id` names it in a report. */
export const gestureCallbacksOf = (runtime: WardicRuntime, id: string, config: () => WardConfig): GestureCallbacks => {
  // The per-move callbacks whose last call threw (#257 item 4): a run of throws reports at its
  // first, so one that throws at every move logs once; a call that returns ends the run.
  let failing: Set<string> | undefined
  /** Report the app's `name` threw `defect`. */
  const report = (name: string, defect: unknown): void => {
    runtime.runFork(Report.failure(`wardic.gesture: ${name} failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ id })))
  }
  /** Call the app's `name`, reported if it throws. */
  const call = <Args extends ReadonlyArray<unknown>>(name: string, callback: ((...args: Args) => void) | undefined, ...args: Args): void => {
    if (Predicate.isUndefined(callback)) return
    try {
      callback(...args)
    } catch (defect) {
      report(name, defect)
    }
  }
  /** Call `onDrag` or `onPan`, at every move: a run of throws is reported at its first. */
  const callPerMove = <Args extends ReadonlyArray<unknown>>(name: string, callback: ((...args: Args) => void) | undefined, ...args: Args): void => {
    if (Predicate.isUndefined(callback)) return
    try {
      callback(...args)
      UndefinedOr.map(failing, (names) => names.delete(name))
    } catch (defect) {
      if (Predicate.isUndefined(failing)) failing = new Set()
      if (failing.has(name)) return
      failing.add(name)
      report(name, defect)
    }
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
    const info = dragInfoOf(sample)
    if (Predicate.isNotUndefined(named)) call(named, own, raw, info)
    if (moving) callPerMove(every, each, raw, info)
  }
  return {
    hovered: (transition) => {
      const name = Bool.match(transition.active, { onTrue: () => "onHoverStart" as const, onFalse: () => "onHoverEnd" as const })
      call(name, config()[name], transition.event.raw as PointerEvent, pointInfoOf(transition.event))
    },
    pressed: (press, element) => {
      const name = PRESS_CALLBACK[press.phase]
      if (Predicate.isUndefined(name)) return
      call(name, config()[name], press.event.raw as WardicPressEvent, pressInfoOf(press, element))
    },
    dragged: (sample) => {
      // A direction-locked drag's lock, at its start, before `onDragStart` (Motion's order).
      if (sample.phase === "start") {
        const c = config()
        if (c.dragDirectionLock === true) call("onDirectionLock", c.onDirectionLock, sample.axis as "x" | "y")
      }
      moved(DRAG_CALLBACK[sample.phase], "onDrag", sample)
    },
    released: () => call("onDragTransitionEnd", config().onDragTransitionEnd),
    panned: (sample) => {
      // Its session's start, at the down: Motion's `onPanSessionStart`, with the point only.
      if (sample.phase === "session") {
        call("onPanSessionStart", config().onPanSessionStart, sample.raw as PointerEvent, pointOfSample(sample))
        return
      }
      moved(PAN_CALLBACK[sample.phase], "onPan", sample as Drag.Sample)
    },
    viewed: (transition) => {
      const name = Bool.match(transition.active, { onTrue: () => "onViewportEnter" as const, onFalse: () => "onViewportLeave" as const })
      call(name, config()[name], transition.raw as IntersectionObserverEntry)
    },
  }
}
