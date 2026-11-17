/**
 * A `w.*` element's gestures (#793, PR 1 and 2; ADR-0071 decision 23; ADR-0047): hover, press, focus, in
 * view and pan, each started the first time a delivery wants it (its `While*`, or a callback of its)
 * while its Feature is built, and kept from then on, as Motion's features start (ADR-0047 decision 5).
 * Each is dom's Feature's `watch`, run in a Scope of the element's own on the provider and closed at its
 * release. An Edge sets the element's entry in the Override stack and sends the callback's Message, at
 * the event, through dom's gesture teller (Motion's order; a throw reported by name, the gesture going
 * on): a function handler runs inside the recognizer's dispatch, so `stopPropagation()` and
 * `preventDefault()` do what they say, and its Message reaches `update` a microtask later. The drag's
 * samples and its hold on `x`/`y` come here too (its track is `drag.ts`'s), so its entry and its
 * callbacks sit with the rest. A gesture wanted without its Feature is inert, and warned once in
 * development.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Recognizer from "@wardic/core/Recognizer"
import type * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as Press from "@wardic/dom/unstable/Press"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Iter from "effect/Iterable"
import * as MutableRef from "effect/MutableRef"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import type { Dispatch, View } from "./element.ts"
import { featureIn, type Provider, reporterOf, warnMissing } from "./services.ts"

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
  /** Whether the element's keys are taken, as a Reorder item's are by its Keyboard reorder (ADR-0037): its press starts from no key. Read as the press starts. */
  readonly keysTaken: () => boolean
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
  /** A Keyboard reorder's lift began or ended (ADR-0037): `WhileDrag` applies as to a drag, the translate keys stay the spine's. */
  readonly lift: (lifted: boolean) => void
  /** A drag's sample, after the track's write: `OnDirectionLock` at a locked start, `OnDragStart`, `OnDrag` at each move, `OnDragEnd`. */
  readonly dragged: (sample: Drag.Sample) => void
  /** The drag's release came to rest on its own: `OnDragTransitionEnd`. */
  readonly released: () => void
  /** Start what the config wants and the Features give, once each: at mount, at each delivery, and as a Feature arrives. */
  readonly check: () => void
  /** Close every recognizer's Scope: at the element's release. */
  readonly dispose: () => void
}

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

/** A callback as the teller hands it to `dispatch`: Foldkit's, told whatever the gesture tells. */
type Told = Ward.Callback<unknown, ReadonlyArray<unknown>>

/** An element's gestures (above): nothing started until `check` wants it. */
export const gesturesOf = ({ provider, element, config, dispatch, onChange, id, pagePoint, keysTaken }: GestureOptions): Gestures => {
  const started = new Map<Gesture, Scope.Closeable>()
  // Which gestures are on: the element's entries in the Override stack.
  const on = MutableRef.make<VariantTree.GestureStates>(VariantTree.NO_GESTURE_STATES)
  // Whether the drag holds `x`/`y` (ADR-0004): from its "start" through its release.
  const dragging = MutableRef.make(false)
  // Whether a Keyboard reorder has the element lifted (ADR-0037): `WhileDrag` applies with no drag.
  const lifted = MutableRef.make(false)
  const flip = (change: Partial<VariantTree.GestureStates>): void => {
    MutableRef.set(on, { ...MutableRef.get(on), ...change })
    onChange()
  }
  const report = reporterOf(provider, id)
  const onDefect: InputFeed.OnDefect = (cause) => report(HANDLER_FAILED, cause)
  // The callbacks' teller (decision 23; dom's, for both bindings): each callback's Message sent through
  // `dispatch`, at the event; one that throws reported by name, and the gesture goes on.
  const teller = GestureFeatures.gestureTellerOf({
    config,
    invoke: (handler, args) => dispatch(handler as Told)(...args),
    report: (name, defect) => report(`wardic.gesture: ${name} failed`, Cause.die(defect)),
  })
  /** Run `watch` in a Scope of the element's own, on the provider, whose services (the Probe, for in view) it has. */
  const run = (watch: Effect.Effect<void, never, Scope.Scope | WardicServices.WardicServices>): Scope.Closeable => {
    const scope = OwnerScope.open(provider.runtime)
    provider.runtime.runSync(watch.pipe(Scope.provide(scope)))
    return scope
  }
  const hovered = (edge: Recognizer.Edge): void => {
    teller.hovered(edge)
    flip({ hovered: edge.active })
  }
  const pressed = (press: Recognizer.PressEvent): void => {
    teller.pressed(press, element)
    flip({ pressed: press.phase === "start" })
  }
  /** Whether its presses reach its pressable ancestors (#439): its `propagate`, read at each press's start. */
  const propagates = (): boolean => Press.tapPropagates(config().propagate)
  const focused = (has: boolean): void => flip({ focused: has })
  const viewed = (edge: Recognizer.ViewEdge): void => {
    teller.viewed(edge)
    flip({ inView: edge.active })
  }
  const dragHeld = (held: boolean): void => {
    if (MutableRef.get(dragging) === held) return
    MutableRef.set(dragging, held)
    flip({ dragged: Bool.or(held, MutableRef.get(lifted)) })
  }
  const lift = (on: boolean): void => {
    if (MutableRef.get(lifted) === on) return
    MutableRef.set(lifted, on)
    flip({ dragged: Bool.or(MutableRef.get(dragging), on) })
  }
  // Each gesture's recognizer: its Feature's watch, with the element's handlers. In view as its
  // `viewport` says, read as it starts (Motion's), over the Environment's Probe. A pan (Q9) moves
  // nothing: its samples to the pan callbacks, its points through the nearest `transformPagePoint`.
  const recognizers: ReadonlyArray<Recognizer> = [
    { name: "hover", wants: GestureFeatures.wantsHover, start: () => UndefinedOr.map(featureIn(provider, Keys.HoverGesture), (hover) => run(hover.watch(element, { on: hovered, onDefect }))) },
    { name: "press", wants: GestureFeatures.wantsPress, start: () => UndefinedOr.map(featureIn(provider, Keys.PressGesture), (press) => run(press.watch(element, { on: pressed, onDefect }, keysTaken(), propagates))) },
    { name: "focus", wants: GestureFeatures.wantsFocus, start: () => UndefinedOr.map(featureIn(provider, Keys.FocusGesture), (focus) => run(focus.watch(element, VISIBLE_FOCUS, { on: focused, onDefect }))) },
    { name: "inView", wants: GestureFeatures.wantsInView, start: () => UndefinedOr.map(featureIn(provider, Keys.InViewGesture), (inView) => run(inView.watch(element, GestureFeatures.inViewOptionsOf(config().viewport), { on: viewed, onDefect }))) },
    { name: "pan", wants: GestureFeatures.wantsPan, start: () => UndefinedOr.map(featureIn(provider, Keys.PanGesture), (pan) => run(pan.watch(element, { on: teller.panned, onDefect }, { mapPoint: WardicConfigValue.pointMapOptionOf(pagePoint) }))) },
  ]
  const check = (): void => {
    const c = config()
    Arr.forEach(recognizers, ({ name, wants, start }) => {
      if (started.has(name)) return
      if (Bool.not(wants(c))) return
      UndefinedOr.match(start(), { onUndefined: () => warnMissing(provider, name, GestureFeatures.GESTURE_WORDS[name]), onDefined: (scope) => started.set(name, scope) })
    })
  }
  return {
    active: () => ({ ...MutableRef.get(on), dragging: MutableRef.get(dragging) }),
    states: () => MutableRef.get(on),
    dragging: () => MutableRef.get(dragging),
    dragHeld,
    lift,
    dragged: teller.dragged,
    released: teller.released,
    check,
    dispose: () => Iter.forEach(started.values(), (scope) => OwnerScope.close(provider.runtime, scope, END_FAILED)),
  }
}
