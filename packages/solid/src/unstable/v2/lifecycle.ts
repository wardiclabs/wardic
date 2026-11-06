/**
 * A ward's animation lifecycle on Solid 2 (#257, ADR-0046): its Retargets' starts and landings,
 * handed over as async values in place of Solid 1's `onAnimationStart` / `onAnimationComplete`.
 *
 * - `settled()`: the last landing, `undefined` before the first. It's ready from its first read (#257
 *   PR 2's Q1, B): a Retarget in flight makes it pending, so `isPending(() => card.settled())` is
 *   "animating", and a read keeps the last landing meanwhile. Pending at its first read, a read with
 *   no `<Loading>` above it would defer the root's mount, the ward's own with it, and the landing it
 *   waits for would never come.
 * - `next("settled")`: a promise of the next landing after the call. It rejects with a `DOMException`
 *   named `"AbortError"` once the ward is disposed, as Web Animations' `finished` does on a cancel.
 * - **A failed animation** (#257 item 4), one a leg's failure keeps from landing: `next("settled")`
 *   rejects with the failure's error, `each("settled")` throws it, and `settled()` throws it at each
 *   read, so a read of it in JSX goes to the reader's `<Errored>`. The next Retarget clears it,
 *   pending, and its landing is read again. It's logged and reported apart (ADR-0030), whoever reads it.
 *
 * - `tapped()` (#427, ADR-0056): the last tap, as `settled()` is the last landing: `undefined`
 *   before the first, pending while a press is held, from a pointer or a key, so
 *   `isPending(() => card.tapped())` is "pressed". A tap resolves it; a cancel, or a press a drag took
 *   over, keeps the last tap. Its first read asks for the press, as `next("tap")` does.
 *
 * One object a ward, the spine's hooks itself. Nothing Solid is made until `settled` is first read,
 * and nothing is allocated for a start or a landing until someone asks: until then they're counts
 * and references.
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { constUndefined, identity } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import type * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as Recognizer from "@wardic/core/Recognizer"
import { type Accessor, createMemo, createSignal, type Owner, runWithOwner } from "solid-js"
import type { WardicAnimationDefinition, WardicValues } from "../../config.ts"
import { dragInfoOf, pointInfoOf, pointOfSample, pressInfoOf, type WardicDragInfo, type WardicPoint, type WardicPointInfo, type WardicPressInfo } from "../../gesture-info.ts"
import { type AnimationHooks, definitionOf, type Resolution } from "../../spine.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import { eachOf, type Listener, Waiters, whenOf } from "./waiters.ts"

/** The gesture layers that were on for an animation: `whileHover`'s, `whileTap`'s and `whileDrag`'s (a drag, or a keyboard reorder's lift). */
export interface WardGestures {
  readonly hover: boolean
  readonly tap: boolean
  readonly drag: boolean
  /** In view: `whileInView` applied. */
  readonly inView: boolean
  /** Focused as the browser shows it: `whileFocus` applied. */
  readonly focus: boolean
}

/** An animation's landing. */
export interface WardSettled {
  /**
   * Motion's `definition` of it: the variant name its `animate` changed to, else its target values
   * (a values map, or a gesture layer turning on or off).
   */
  readonly definition: WardicAnimationDefinition
  /** The values it landed on: every key its Retarget animated. */
  readonly target: WardicValues
  /** The gesture layers that were on when it started. */
  readonly gestures: WardGestures
}

/** A point in the viewport, as `clientX` / `clientY` and `getBoundingClientRect()` measure. */
export type WardPoint = WardicPoint

/**
 * The element a gesture's event happened on: the ward's, or, for a ward given to `wardRef`,
 * the element it drives. Motion's `event.currentTarget`: Solid 2's events have no DOM event.
 */
export type WardElement = HTMLElement | SVGElement

/**
 * A hover's or a press's event (Motion's `EventInfo` / `TapInfo`): where the pointer was, in
 * the viewport, and the element it was on.
 */
export interface WardPointInfo extends WardicPointInfo {
  readonly element: WardElement
}

/**
 * A press's event: where it was, in the viewport, how it was made (`input: "pointer" |
 * "keyboard"`), and the element it was on. A **Keyboard press**'s point is the element's centre,
 * measured at the key.
 */
export interface WardPressInfo extends WardicPressInfo {
  readonly element: WardElement
}

/**
 * A drag's event (Motion's `PanInfo`): where the pointer was, in the viewport, the drag's
 * `offset`, `delta` and `velocity` (`gesture-info.ts`), and the element dragged.
 */
export interface WardDragInfo extends WardicDragInfo {
  readonly element: WardElement
}

/** What each of `next(name)`'s names resolves to. */
export interface WardEvents {
  /** The next landing. */
  readonly settled: WardSettled
  /** The pointer came over the element (Motion's `onHoverStart`); touch never hovers. */
  readonly hoverStart: WardPointInfo
  /**
   * The pointer over the element while it's hovered: its start, told after `hoverStart` at the
   * same point, then each move until `hoverEnd`, as `drag` is a drag's. Wardic's own: Motion's hover
   * has only a start and an end.
   */
  readonly hover: WardPointInfo
  /** It left, or a press held on it while it left was let go (Motion's `onHoverEnd`). */
  readonly hoverEnd: WardPointInfo
  /**
   * A press began on the element (Motion's `onTapStart`): a primary pointer's down, or Enter or Space
   * going down while it has focus (a **Keyboard press**).
   */
  readonly pressStart: WardPressInfo
  /** That press ended in a release on the element or inside it, or its key coming up (Motion's `onTap`). */
  readonly tap: WardPressInfo
  /**
   * It ended elsewhere, or was cancelled; a key's, when the element lost focus (Motion's
   * `onTapCancel`). A press a drag took over is neither.
   */
  readonly tapCancel: WardPressInfo
  /** A drag of the element started, past its threshold (Motion's `onDragStart`). */
  readonly dragStart: WardDragInfo
  /**
   * With `dragDirectionLock`, the axis a drag locked to, at its start, before its `dragStart`
   * (Motion's `onDirectionLock`).
   */
  readonly directionLock: "x" | "y"
  /** That drag moved: its start and each move after (Motion's `onDrag`). */
  readonly drag: WardDragInfo
  /** That drag ended at its release (Motion's `onDragEnd`). */
  readonly dragEnd: WardDragInfo
  /**
   * The drag's release came to rest on its own (Motion's `onDragTransitionEnd`): its momentum
   * or its spring back, or at once for one released in place. Not for one a grab stopped.
   */
  readonly dragTransitionEnd: undefined
  /**
   * A pan's session began: a primary pointer went down on the element (Motion's
   * `onPanSessionStart`). A pan moves nothing; once started, it counts as a drag for the
   * element's press and hover. It sets no `touch-action`: give the element one for touch.
   */
  readonly panSessionStart: WardPointInfo
  /** That pan started, past its threshold (Motion's `onPanStart`). */
  readonly panStart: WardDragInfo
  /** That pan moved: its start and each move after (Motion's `onPan`). */
  readonly pan: WardDragInfo
  /** That pan ended at its release, or was cancelled (Motion's `onPanEnd`). Only a pan that started. */
  readonly panEnd: WardDragInfo
  /**
   * The element came into view, as its `viewport` says (Motion's `onViewportEnter`). One that
   * starts out of view tells nothing until it enters.
   */
  readonly viewportEnter: undefined
  /** It left the view (Motion's `onViewportLeave`). With `viewport.once`, never after its first entry. */
  readonly viewportLeave: undefined
  /**
   * A layout animation of the element started, at the frame it takes its first step, after that
   * frame is painted (Motion's `onLayoutAnimationStart`). A restart starts again.
   */
  readonly layoutStart: undefined
  /**
   * A layout animation of the element landed on its own (Motion's `onLayoutAnimationComplete`): not
   * one a restart interrupted, a window resize finished early, or an unmount cut off.
   */
  readonly layoutComplete: undefined
}

/** A Retarget's failure (#257 item 4), as `settled()`'s memo holds it: `read` throws its error. */
class Failure {
  readonly error: unknown
  constructor(error: unknown) {
    this.error = error
  }
}

/** What `next(name)` waits for. */
export type WardEvent = keyof WardEvents

/** The `AbortError`'s message for a `next` the ward's disposal cut off. */
const GONE = "The ward was disposed before its next event."

/** A gesture whose recognizer the ward runs only once wanted (#87, #257, #273). */
export type WantedGesture = "hover" | "press" | "pan" | "inView"

/** The gesture whose recognizer an event needs: `next("tap")` needs the press one running. */
const GESTURE_OF: Partial<Record<WardEvent, WantedGesture>> = {
  hoverStart: "hover",
  hover: "hover",
  hoverEnd: "hover",
  pressStart: "press",
  tap: "press",
  tapCancel: "press",
  panSessionStart: "pan",
  panStart: "pan",
  pan: "pan",
  panEnd: "pan",
  viewportEnter: "inView",
  viewportLeave: "inView",
}

/** Each press phase's event: a press a drag took over has none (Motion tells neither). */
const PRESS_EVENT: Record<Recognizer.PressPhase, WardEvent | undefined> = {
  start: "pressStart",
  tap: "tap",
  cancel: "tapCancel",
  dragged: undefined,
}

/** A drag's or a pan's start or end. */
type MovementEvent = "dragStart" | "dragEnd" | "panStart" | "panEnd"

/** Each drag phase's event: its end; its start, which `drag` hears too, is told on its own. */
const DRAG_EVENT: Record<Drag.Sample["phase"], MovementEvent | undefined> = {
  start: "dragStart",
  move: undefined,
  end: "dragEnd",
}

/** Each pan phase's event past its session's start: as {@link DRAG_EVENT}, `pan` its every move. */
const PAN_EVENT: Record<Drag.Sample["phase"], MovementEvent | undefined> = {
  start: "panStart",
  move: undefined,
  end: "panEnd",
}

/**
 * A ward's lifecycle, made under its `owner`. It's the spine's {@link AnimationHooks}; the ward
 * hands over {@link Lifecycle.read} as `settled` and {@link Lifecycle.wait} as `next`, and calls
 * {@link Lifecycle.dispose} in its own cleanup. A landing's gestures are the layers its Retarget's
 * resolution was made with.
 */
export class Lifecycle implements AnimationHooks {
  // The Retargets started and the last one landed, counted, and the one in flight.
  private starts = 0
  private landed = 0
  private flying: Resolution | undefined = undefined
  // The last landing, built when it's asked for: its resolution and the variant before it.
  private landedResolution: Resolution | undefined = undefined
  private landedPrevious: Resolution | undefined = undefined
  private last: WardSettled | undefined = undefined
  // Made at the first read: the setter of the count it tracks, its memo, and its pending read's resolver.
  private setCount: ((count: number) => void) | undefined = undefined
  private memo: Accessor<WardSettled | Failure | undefined> | undefined = undefined
  private waiting: ((landing: WardSettled | Failure) => void) | undefined = undefined
  // The last Retarget's failure, until the next starts (#257 item 4).
  private failure: Failure | undefined = undefined
  // `tapped()` (#427): the presses started and ended, counted; the last tap's press and element, kept
  // as references until it's asked for, and its info, built then; and, made at the first read, the
  // setter of the count it tracks, its memo, and its pending read's resolver.
  private pressStarts = 0
  private pressEnds = 0
  private tapPress: Recognizer.PressEvent | undefined = undefined
  private tapElement: WardElement | undefined = undefined
  private lastTap: WardPressInfo | undefined = undefined
  private setPresses: ((count: number) => void) | undefined = undefined
  private tapMemo: Accessor<WardPressInfo | undefined> | undefined = undefined
  private tapWaiting: ((tap: WardPressInfo | undefined) => void) | undefined = undefined
  // The `next(name)` calls waiting, made at the first; and whether the ward is gone.
  private events: Waiters<WardEvents> | undefined = undefined
  private disposed = false
  // The gestures a `next` has asked for, whose recognizers the ward runs from then on.
  private hover = false
  private press = false
  private pan = false
  private inView = false
  private readonly owner: Owner | null
  private readonly want: (gesture: WantedGesture) => void

  /** `want` starts a gesture's recognizer on the mounted element the first time a `next` needs it. */
  constructor(owner: Owner | null, want: (gesture: WantedGesture) => void) {
    this.owner = owner
    this.want = want
  }

  /** Whether a `next` has asked for the hover events, so the ward runs its recognizer. */
  get wantsHover(): boolean {
    return this.hover
  }

  /** Whether a `next` has asked for the press events. */
  get wantsPress(): boolean {
    return this.press
  }

  /** Whether a `next` has asked for the pan events (#273). */
  get wantsPan(): boolean {
    return this.pan
  }

  /** Whether a `next` has asked for the viewport events (#273). */
  get wantsInView(): boolean {
    return this.inView
  }

  started(resolution: Resolution): void {
    this.starts++
    this.flying = resolution
    this.failure = undefined
    // From a microtask, as at the first read (#315): a Retarget starts in Solid's flush, the mount's
    // among them, where `render` still watches for a pending read reaching its root. A `<Loading>`
    // already showing its content doesn't catch one, so a plain `settled()` read under it was
    // reported as an async read outside any boundary, though the mount wasn't held.
    if (Predicate.isNotUndefined(this.setCount)) queueMicrotask(this.tellStarts)
  }

  /** `settled()`'s count set to the starts now: its read pends while one is in flight. */
  private readonly tellStarts = (): void => {
    UndefinedOr.map(this.setCount, (set) => set(this.starts))
  }

  settled(resolution: Resolution, previous: Resolution | undefined): void {
    // A landing told after a later Retarget started (a settle waits for the gate's flush) is stale.
    if (resolution !== this.flying) return
    this.landed = this.starts
    this.landedResolution = resolution
    this.landedPrevious = previous
    this.last = undefined
    // In the landing's own flush, not a start's microtask after: the count equals the landings, so
    // `settled()` reads the landing, never pending (SE6, a Retarget with nothing to animate).
    this.tellStarts()
    const resolve = this.waiting
    if (Bool.and(Predicate.isUndefined(resolve), Predicate.isUndefined(this.events))) return
    this.waiting = undefined
    if (Predicate.isNotUndefined(resolve)) resolve(this.lastLanding() as WardSettled)
    this.tell("settled", this.landing)
  }

  /**
   * The Retarget in flight can't land: a leg failed (#257 item 4). It's no longer in flight;
   * `settled()` reads as errored until the next starts, and the waits for `settled` are rejected.
   */
  failed(resolution: Resolution, error: unknown): void {
    if (resolution !== this.flying) return
    this.flying = undefined
    this.landed = this.starts
    const failure = new Failure(error)
    this.failure = failure
    const resolve = this.waiting
    this.waiting = undefined
    if (Predicate.isNotUndefined(resolve)) resolve(failure)
    UndefinedOr.map(this.events, (events) => events.fail("settled", error))
  }

  /** A hover's start or end on `element` (#257): its start is the first `hover` too (#397). */
  hovered(edge: Recognizer.Edge, element: WardElement): void {
    if (Predicate.isUndefined(this.events)) return
    const info = (): WardPointInfo => ({ ...pointInfoOf(edge.event), element })
    if (edge.active) {
      this.tell("hoverStart", info)
      this.tell("hover", info)
      return
    }
    this.tell("hoverEnd", info)
  }

  /** A move of the pointer over `element` while it's hovered (#397). */
  hoverMoved(event: InputSource.PointerLikeEvent, element: WardElement): void {
    if (Predicate.isUndefined(this.events)) return
    this.tell("hover", () => ({ ...pointInfoOf(event), element }))
  }

  /** A press's start or end (#257): a press a drag took over tells nothing. */
  pressed(press: Recognizer.PressEvent, element: WardElement): void {
    this.pressNow(press, element)
    if (Predicate.isUndefined(this.events)) return
    const name = PRESS_EVENT[press.phase]
    if (Predicate.isUndefined(name)) return
    this.tell(name, () => ({ ...pressInfoOf(press, element), element }))
  }

  /**
   * A drag's sample (#257, #273): its start, each move (its start among them) and its end are told;
   * a direction-locked one's (`locked`) lock first, at its start. An end its controls cancelled
   * (#431) isn't, as Motion's `cancel` tells no `onDragEnd`.
   */
  dragged(sample: Drag.Sample, locked: boolean, element: WardElement): void {
    if (sample.cancelled === true) return
    if (Bool.and(locked, sample.phase === "start")) this.tell("directionLock", () => sample.axis as "x" | "y")
    this.moved(DRAG_EVENT[sample.phase], "drag", sample, element)
  }

  /** A pan's sample (#273): its session's start, then as a drag's. */
  panned(sample: DragRecognizer.PanSample, element: WardElement): void {
    if (Predicate.isUndefined(this.events)) return
    if (sample.phase === "session") {
      this.tell("panSessionStart", () => ({ ...pointOfSample(sample), element }))
      return
    }
    this.moved(PAN_EVENT[sample.phase], "pan", sample as Drag.Sample, element)
  }

  /** The drag's release came to rest on its own (#273). */
  released(): void {
    this.tell("dragTransitionEnd", constUndefined)
  }

  /** A layout animation's start (#257): the projection calls it after its first frame is painted. */
  layoutStarted(): void {
    this.tell("layoutStart", constUndefined)
  }

  /** A layout animation's landing (#257). */
  layoutCompleted(): void {
    this.tell("layoutComplete", constUndefined)
  }

  /** An in-view edge (#273): the element entered or left the view. */
  viewed(edge: Recognizer.ViewEdge): void {
    this.tell(Bool.match(edge.active, { onTrue: (): WardEvent => "viewportEnter", onFalse: () => "viewportLeave" }), constUndefined)
  }

  /** A drag's or a pan's sample past a pan's session's start: its start's or end's event (`named`), then `every` at its start and each move. */
  private moved(named: MovementEvent | undefined, every: "drag" | "pan", sample: Drag.Sample, element: WardElement): void {
    if (Predicate.isUndefined(this.events)) return
    const info = (): WardDragInfo => ({ ...dragInfoOf(sample), element })
    if (Predicate.isNotUndefined(named)) this.tell(named, info)
    if (sample.phase !== "end") this.tell(every, info)
  }

  /** Resolve the `next(name)` calls waiting, with `value()`, made once there are any. */
  private tell<E extends WardEvent>(name: E, value: () => WardEvents[E]): void {
    UndefinedOr.map(this.events, (events) => events.tell(name, value))
  }

  /**
   * A press for `tapped()` (#427): its start counted, and pending from there; its end counted, a tap's
   * kept as references, and the pending read resolved with the last tap. Once `tapped()` has been read,
   * its memo pends at each press's start, read or not, so a tap's info is built here, at the tap: a
   * keyboard press's centre is measured at the key. Before, nothing is allocated for a tap.
   */
  private pressNow(press: Recognizer.PressEvent, element: WardElement): void {
    if (press.phase === "start") {
      this.pressStarts++
      this.tellPresses()
      return
    }
    this.pressEnds = this.pressStarts
    if (press.phase === "tap") {
      this.tapPress = press
      this.tapElement = element
      this.lastTap = undefined
    }
    this.tellPresses()
    const resolve = this.tapWaiting
    if (Predicate.isUndefined(resolve)) return
    this.tapWaiting = undefined
    resolve(this.lastTapNow())
  }

  /** `tapped()`'s count set to the presses started: its read pends while one is held. */
  private readonly tellPresses = (): void => {
    UndefinedOr.map(this.setPresses, (set) => set(this.pressStarts))
  }

  /** The last tap's info, built from its references the first time it's asked for. */
  private lastTapNow(): WardPressInfo | undefined {
    if (Bool.or(Predicate.isNotUndefined(this.lastTap), Predicate.isUndefined(this.tapPress))) return this.lastTap
    const element = this.tapElement as WardElement
    this.lastTap = { ...pressInfoOf(this.tapPress as Recognizer.PressEvent, element), element }
    return this.lastTap
  }

  /**
   * `tapped()` (#427): the last tap, made reactive at the first read, which also asks for the press,
   * as `next("tap")` does, so the ward runs its recognizer.
   */
  tapped(): WardPressInfo | undefined {
    if (Predicate.isUndefined(this.tapMemo)) {
      this.tapMemo = runWithOwner(this.owner, () => this.makeTapMemo())
      this.wanted("press")
    }
    return (this.tapMemo as Accessor<WardPressInfo | undefined>)()
  }

  // The count of presses it tracks starts at the ended count, so its first read is never pending. A
  // press held at that read is set from a microtask, as `settled()`'s Retarget in flight is.
  private makeTapMemo(): Accessor<WardPressInfo | undefined> {
    const [count, set] = createSignal(this.pressEnds)
    this.setPresses = set
    const memo = createMemo((): WardPressInfo | undefined | PromiseLike<WardPressInfo | undefined> => {
      if (count() === this.pressEnds) return this.lastTapNow()
      return new Promise<WardPressInfo | undefined>((resolve) => {
        this.tapWaiting = resolve
      })
    }, CLIENT_ONLY)
    if (this.pressStarts !== this.pressEnds) queueMicrotask(this.tellPresses)
    return memo
  }

  /** The last landing, for {@link tell}. */
  private readonly landing = (): WardSettled => this.lastLanding() as WardSettled

  /**
   * `settled()`: the last landing, made reactive at the first read. A failure (#257 item 4) is
   * thrown here, in the reader, so the reader's `<Errored>` catches it: the memo is the ward's, owned
   * outside any boundary the reader is in, so it holds the failure as a value rather than erroring.
   */
  read(): WardSettled | undefined {
    if (Predicate.isUndefined(this.memo)) this.memo = runWithOwner(this.owner, () => this.makeMemo())
    const value = this.memo()
    if (value instanceof Failure) throw value.error
    return value
  }

  /**
   * `next(name)`: a promise of the next `name` after the call. A gesture's event starts that
   * gesture's recognizer, if the ward doesn't run it already.
   */
  wait<E extends WardEvent>(name: E): Promise<WardEvents[E]> {
    const waited = this.eventsNow().wait(name)
    const gesture = GESTURE_OF[name]
    if (Bool.and(Predicate.isNotUndefined(gesture), Bool.not(this.disposed))) this.wanted(gesture as WantedGesture)
    return waited
  }

  /**
   * Hear every `name` from the call on (#355, `when`), until the returned stop or the ward's end. A
   * gesture's event starts that gesture's recognizer, as a {@link wait} does.
   */
  readonly listen = <E extends WardEvent>(name: E, listener: Listener<WardEvents[E]>): (() => void) => {
    const stop = this.eventsNow().listen(name, listener)
    const gesture = GESTURE_OF[name]
    if (Bool.and(Predicate.isNotUndefined(gesture), Bool.not(this.disposed))) this.wanted(gesture as WantedGesture)
    return stop
  }

  /** `when(name)` (#355): every `name`, as a memo for an effect: see `whenOf`. */
  when<E extends WardEvent>(name: E): Accessor<WardEvents[E]> {
    return whenOf<WardEvents, E>(this, name)
  }

  /**
   * `each(name)`: every `name` from the call on, as an async iterable (#257): each step is a
   * {@link wait}, so one that comes while the loop's body runs is missed, as a `next` asked later
   * would miss it. It ends, rather than rejecting, once the ward is disposed.
   */
  each<E extends WardEvent>(name: E): AsyncIterable<WardEvents[E]> {
    return eachOf<WardEvents, E>(this, name)
  }

  /** The waits and listeners, made at the first: gone at once if the ward is. */
  private eventsNow(): Waiters<WardEvents> {
    if (Predicate.isUndefined(this.events)) {
      this.events = new Waiters<WardEvents>(GONE)
      if (this.disposed) this.events.dispose()
    }
    return this.events
  }

  /** The ward is gone: every `next` waiting is rejected, and any asked later at once. */
  dispose(): void {
    this.disposed = true
    UndefinedOr.map(this.events, (events) => events.dispose())
  }

  /** A gesture a `next` needs: its recognizer is started the first time. */
  private wanted(gesture: WantedGesture): void {
    if (gesture === "hover") {
      if (this.hover) return
      this.hover = true
    }
    if (gesture === "press") {
      if (this.press) return
      this.press = true
    }
    if (gesture === "pan") {
      if (this.pan) return
      this.pan = true
    }
    if (gesture === "inView") {
      if (this.inView) return
      this.inView = true
    }
    this.want(gesture)
  }

  private lastLanding(): WardSettled | undefined {
    const resolution = this.landedResolution
    if (Bool.or(Predicate.isNotUndefined(this.last), Predicate.isUndefined(resolution))) return this.last
    const landing = resolution as Resolution
    const active = landing.active
    this.last = {
      definition: definitionOf(landing, this.landedPrevious) as WardicAnimationDefinition,
      target: landing.resolved,
      gestures: { hover: active.hovered, tap: active.pressed, drag: active.dragged, inView: active.inView, focus: active.focused },
    }
    return this.last
  }

  // The count of starts it tracks starts at the landed count, so its first read is never pending. A
  // Retarget in flight at that read is set from a microtask: a change in flight from there
  // (`isPending`), which a write in the read's own flush wouldn't be (Solid applies it there).
  private makeMemo(): Accessor<WardSettled | Failure | undefined> {
    const [count, set] = createSignal(this.landed)
    this.setCount = set
    const memo = createMemo((): WardSettled | Failure | undefined | PromiseLike<WardSettled | Failure> => {
      // At rest: the last landing, or a failure told before this run (#257 item 4).
      if (count() === this.landed) return UndefinedOr.match(this.failure, { onUndefined: () => this.lastLanding(), onDefined: identity })
      return new Promise<WardSettled | Failure>((resolve) => {
        this.waiting = resolve
      })
    }, CLIENT_ONLY)
    if (this.starts !== this.landed) queueMicrotask(this.tellStarts)
    return memo
  }
}
