/**
 * A `w.*` element's gestures (#793, PR 1; ADR-0071 decision 23; ADR-0047): hover, press, focus and in
 * view, each started the first time a delivery wants it (its `While*`, or a callback of its) while its
 * Feature is built, and kept from then on, as Motion's features start (ADR-0047 decision 5). Each is
 * dom's Feature's `watch`, run in a Scope of the element's own on the provider and closed at its
 * release. An Edge sets the element's entry in the Override stack and sends the callback's Message, at
 * the event: a function handler runs inside the recognizer's dispatch, so `stopPropagation()` and
 * `preventDefault()` do what they say, and its Message reaches `update` a microtask later; one that
 * throws is reported, and the gesture goes on. A gesture wanted without its Feature is inert, and
 * warned once in development.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Recognizer from "@wardic/core/Recognizer"
import type * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import * as Report from "@wardic/dom/Report"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import * as GestureInfo from "@wardic/dom/unstable/GestureInfo"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as Press from "@wardic/dom/unstable/Press"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { constUndefined } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as MutableRef from "effect/MutableRef"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import type { Dispatch, View } from "./element.ts"
import { featureIn, missingMessage, type Provider } from "./services.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** What an element's gestures are made with. */
export interface GestureOptions {
  readonly provider: Provider
  readonly element: HTMLElement
  /** The element's config now, as its last delivery gave it: read at each event. */
  readonly config: () => View
  /** What sends a callback's Message: the element's Mount queue, unless replay has the view. */
  readonly dispatch: Dispatch
  /** Called after an entry flips, so the element re-resolves its Override stack. */
  readonly onChange: () => void
  /** The element's id, for a report. */
  readonly id: string
  /** The nearest `w.Config`'s `transformPagePoint` (Q9), read at each of the pan's downs. */
  readonly pagePoint: () => WardConfig.WardicTransformPoint | undefined
}

/** An element's gestures (above). */
export interface Gestures {
  /** Which entries of the Override stack are on now, the drag's among them. */
  readonly active: () => Spine.Active
  /** Which gestures are on, for the names the element's variant node hands down (#291). */
  readonly states: () => VariantTree.GestureStates
  /** Whether a drag holds `x`/`y` now (ADR-0004): what the spine's follower reads. */
  readonly dragging: () => boolean
  /** The drag took `x`/`y`, or handed them back (the track's `setDragging`): its entry flips once each way. */
  readonly dragHeld: (on: boolean) => void
  /** A drag's sample, after the track's write: `OnDirectionLock` at a locked start, `OnDragStart`, `OnDrag` at each move, `OnDragEnd`. */
  readonly dragged: (sample: Drag.Sample) => void
  /** The drag's release came to rest on its own: `OnDragTransitionEnd`. */
  readonly released: () => void
  /** Start what the config wants and the Features give, once each: at mount, at each delivery, and as a Feature arrives. */
  readonly check: () => void
  /** Close every recognizer's Scope: at the element's release. */
  readonly dispose: () => void
}

/** A drag's or a pan's start or end callback. */
type MovementCallback = "onDragStart" | "onDragEnd" | "onPanStart" | "onPanEnd"

/** A gesture the element may want: its Feature's name. */
type Gesture = "hover" | "press" | "focus" | "inView" | "pan"

/** A gesture's recognizer, as the element starts it: whether its config wants it, and its watch, `undefined` without its Feature. */
interface Recognizer {
  readonly name: Gesture
  readonly wants: (config: GestureFeatures.GestureWants) => boolean
  readonly start: () => Scope.Closeable | undefined
}

/** Focus as the browser shows it (`:focus-visible`, Motion's `whileFocus`): a keyboard's, not a click's. */
const VISIBLE_FOCUS: Recognizer.FocusOptions = { visible: true }

/** A recognizer's end that failed, at the element's release. */
const END_FAILED = "wardic.gesture: a recognizer's end failed"

/** A recognizer's own handler threw, dom's or the port's, past the app's callbacks. */
const HANDLER_FAILED = "wardic.gesture: a recognizer's handler failed"

/** An element's gestures (above): nothing started until `check` wants it. */
export const gesturesOf = ({ provider, element, config, dispatch, onChange, id, pagePoint }: GestureOptions): Gestures => {
  const started = new Map<Gesture, Scope.Closeable>()
  // Which gestures are on: the element's entries in the Override stack.
  const on = MutableRef.make<VariantTree.GestureStates>(VariantTree.NO_GESTURE_STATES)
  // Whether the drag holds `x`/`y` (ADR-0004): from its "start" through its release.
  const dragging = MutableRef.make(false)
  const flip = (change: Partial<VariantTree.GestureStates>): void => {
    MutableRef.set(on, { ...MutableRef.get(on), ...change })
    onChange()
  }
  const report = (label: string, cause: Cause.Cause<never>): void => {
    provider.runtime.runFork(Report.failure(label, cause).pipe(Effect.annotateLogs({ id })))
  }
  const onDefect: InputFeed.OnDefect = (cause) => report(HANDLER_FAILED, cause)
  // The guard around the app's callbacks (#257 item 4; dom's, for both bindings): a throw reported by
  // name and the gesture goes on; `onDrag`'s and `onPan`'s run of throws reported at its first.
  const guard = GestureFeatures.callbackGuard((name, defect) => report(`wardic.gesture: ${name} failed`, Cause.die(defect)))
  /** Send the app's `name` its Message, reported if it throws. */
  const told = guard.once
  /** Run `watch` in a Scope of the element's own, on the provider, whose services (the Probe, for in view) it has. */
  const run = (watch: Effect.Effect<void, never, Scope.Scope | WardicServices.WardicServices>): Scope.Closeable => {
    const scope = OwnerScope.open(provider.runtime)
    provider.runtime.runSync(watch.pipe(Scope.provide(scope)))
    return scope
  }
  const hovered = (edge: Recognizer.Edge): void => {
    const name = Bool.match(edge.active, { onTrue: () => "onHoverStart" as const, onFalse: () => "onHoverEnd" as const })
    UndefinedOr.map(config()[name], (handler) => told(name, () => dispatch(handler)(edge.event.raw as PointerEvent, GestureInfo.pointInfoOf(edge.event))))
    flip({ hovered: edge.active })
  }
  const pressed = (press: Recognizer.PressEvent): void => {
    const name = GestureFeatures.PRESS_CALLBACK[press.phase]
    if (Predicate.isNotUndefined(name)) UndefinedOr.map(config()[name], (handler) => told(name, () => dispatch(handler)(press.event.raw as Ward.PressEvent, GestureInfo.pressInfoOf(press, element))))
    flip({ pressed: press.phase === "start" })
  }
  /** Whether its presses reach its pressable ancestors (#439): its `propagate`, read at each press's start. */
  const propagates = (): boolean => Press.tapPropagates(config().propagate)
  const focused = (has: boolean): void => flip({ focused: has })
  /**
   * A drag's or a pan's sample, past a pan's session's start: its start's or its end's callback
   * (`named`), then `every`, which hears its start and each move (Motion's pan session runs `onMove` at
   * the start too). The info is built once, for whichever is set.
   */
  const moved = (named: MovementCallback | undefined, every: "onDrag" | "onPan", sample: Drag.Sample): void => {
    const c = config()
    const own = UndefinedOr.match(named, { onUndefined: constUndefined, onDefined: (key) => c[key] })
    const each = Bool.match(sample.phase !== "end", { onTrue: () => c[every], onFalse: constUndefined })
    if (Bool.and(Predicate.isUndefined(own), Predicate.isUndefined(each))) return
    const raw = sample.raw as PointerEvent
    const info = GestureInfo.dragInfoOf(sample)
    UndefinedOr.map(named, (key) => UndefinedOr.map(own, (handler) => told(key, () => dispatch(handler)(raw, info))))
    UndefinedOr.map(each, (handler) => guard.perMove(every, () => dispatch(handler)(raw, info)))
  }
  const dragged = (sample: Drag.Sample): void => {
    // A drag its controls cancelled (#431) ends untold, as Motion's `cancel` tells no `onDragEnd`.
    if (sample.cancelled === true) return
    // A direction-locked drag's lock, at its start, before `onDragStart` (Motion's order).
    if (sample.phase === "start") {
      const c = config()
      if (c.dragDirectionLock === true) UndefinedOr.map(c.onDirectionLock, (handler) => told("onDirectionLock", () => dispatch(handler)(sample.axis as "x" | "y")))
    }
    moved(GestureFeatures.DRAG_CALLBACK[sample.phase], "onDrag", sample)
  }
  const released = (): void => {
    UndefinedOr.map(config().onDragTransitionEnd, (handler) => told("onDragTransitionEnd", () => dispatch(handler)(undefined)))
  }
  const panned = (sample: DragRecognizer.PanSample): void => {
    // Its session's start, at the down: Motion's `onPanSessionStart`, with the point only.
    if (sample.phase === "session") {
      UndefinedOr.map(config().onPanSessionStart, (handler) => told("onPanSessionStart", () => dispatch(handler)(sample.raw as PointerEvent, GestureInfo.pointOfSample(sample))))
      return
    }
    moved(GestureFeatures.PAN_CALLBACK[sample.phase], "onPan", sample as Drag.Sample)
  }
  const dragHeld = (held: boolean): void => {
    if (MutableRef.get(dragging) === held) return
    MutableRef.set(dragging, held)
    flip({ dragged: held })
  }
  const viewed = (edge: Recognizer.ViewEdge): void => {
    const name = Bool.match(edge.active, { onTrue: () => "onViewportEnter" as const, onFalse: () => "onViewportLeave" as const })
    UndefinedOr.map(config()[name], (handler) => told(name, () => dispatch(handler)(edge.raw as IntersectionObserverEntry)))
    flip({ inView: edge.active })
  }
  // Each gesture's recognizer: its Feature's watch, with the element's handlers. In view as its
  // `viewport` says, read as it starts (Motion's), over the Environment's Probe.
  const recognizers: ReadonlyArray<Recognizer> = [
    { name: "hover", wants: GestureFeatures.wantsHover, start: () => UndefinedOr.map(featureIn(provider, Keys.HoverGesture), (hover) => run(hover.watch(element, { on: hovered, onDefect }))) },
    { name: "press", wants: GestureFeatures.wantsPress, start: () => UndefinedOr.map(featureIn(provider, Keys.PressGesture), (press) => run(press.watch(element, { on: pressed, onDefect }, false, propagates))) },
    { name: "focus", wants: GestureFeatures.wantsFocus, start: () => UndefinedOr.map(featureIn(provider, Keys.FocusGesture), (focus) => run(focus.watch(element, VISIBLE_FOCUS, { on: focused, onDefect }))) },
    { name: "inView", wants: GestureFeatures.wantsInView, start: () => UndefinedOr.map(featureIn(provider, Keys.InViewGesture), (inView) => run(inView.watch(element, GestureFeatures.inViewOptionsOf(config().viewport), { on: viewed, onDefect }))) },
    // A pan (Q9) moves nothing: its samples to the pan callbacks, its points through the nearest `transformPagePoint`.
    { name: "pan", wants: GestureFeatures.wantsPan, start: () => UndefinedOr.map(featureIn(provider, Keys.PanGesture), (pan) => run(pan.watch(element, { on: panned, onDefect }, { mapPoint: WardicConfigValue.pointMapOptionOf(pagePoint) }))) },
  ]
  /** Development's word on a gesture wanted without its Feature (#511): once per provider, and not while a load is on its way (Q15). */
  const missing = (name: Gesture): void => {
    if (DEV && Bool.not(provider.features.pending())) provider.registry.warnOnce(name, missingMessage(name, GestureFeatures.GESTURE_WORDS[name]))
  }
  const check = (): void => {
    const c = config()
    Arr.forEach(recognizers, ({ name, wants, start }) => {
      if (started.has(name)) return
      if (Bool.not(wants(c))) return
      UndefinedOr.match(start(), { onUndefined: () => missing(name), onDefined: (scope) => started.set(name, scope) })
    })
  }
  return {
    active: () => ({ ...MutableRef.get(on), dragging: MutableRef.get(dragging) }),
    states: () => MutableRef.get(on),
    dragging: () => MutableRef.get(dragging),
    dragHeld,
    dragged,
    released,
    check,
    dispose: () => Iter.forEach(started.values(), (scope) => OwnerScope.close(provider.runtime, scope, END_FAILED)),
  }
}
