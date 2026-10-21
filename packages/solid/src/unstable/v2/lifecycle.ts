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
 *
 * One object a ward, the spine's hooks itself. Nothing Solid is made until `settled` is first read,
 * and nothing is allocated for a start or a landing until someone asks: until then they're counts
 * and references.
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { constUndefined } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Drag from "@wardic/core/Drag"
import type * as Recognizer from "@wardic/core/Recognizer"
import { type Accessor, createMemo, createSignal, type Owner, runWithOwner } from "solid-js"
import type { WardicAnimationDefinition, WardicValues } from "../../config.ts"
import { dragInfoOf, pointInfoOf, pointOfSample, type WardicDragInfo, type WardicPoint, type WardicPointInfo } from "../../gesture-info.ts"
import { type AnimationHooks, definitionOf, type Resolution } from "../../spine.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import { eachOf, Waiters } from "./waiters.ts"

/** The gesture layers that were on for an animation: `whileHover`'s, `whileTap`'s and `whileDrag`'s (a drag, or a keyboard reorder's lift). */
export interface WardGestures {
  readonly hover: boolean
  readonly tap: boolean
  readonly drag: boolean
}

/** An animation's landing (#257, ADR-0046). */
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

/** A point in the viewport, as `clientX` / `clientY` and `getBoundingClientRect()` measure (#257). */
export type WardPoint = WardicPoint

/** A hover's or a press's event (#257, Motion's `EventInfo` / `TapInfo`): where the pointer was, in the viewport. */
export type WardPointInfo = WardicPointInfo

/**
 * A drag's event (#257, Motion's `PanInfo`): where the pointer was, in the viewport, and the drag's
 * `offset`, `delta` and `velocity` (`gesture-info.ts`).
 */
export type WardDragInfo = WardicDragInfo

/** What each of `next(name)`'s names resolves to (#257). */
export interface WardEvents {
  /** The next landing. */
  readonly settled: WardSettled
  /** The pointer came over the element (Motion's `onHoverStart`); touch never hovers. */
  readonly hoverStart: WardPointInfo
  /** It left, or a press held on it while it left was let go (Motion's `onHoverEnd`). */
  readonly hoverEnd: WardPointInfo
  /** A press began on the element (Motion's `onTapStart`). */
  readonly pressStart: WardPointInfo
  /** That press ended in a release on the element or inside it (Motion's `onTap`). */
  readonly tap: WardPointInfo
  /** It ended elsewhere, or was cancelled (Motion's `onTapCancel`). A press a drag took over is neither. */
  readonly tapCancel: WardPointInfo
  /** A drag of the element started, past its threshold (Motion's `onDragStart`). */
  readonly dragStart: WardDragInfo
  /** That drag moved: its start and each move after (Motion's `onDrag`, #273). */
  readonly drag: WardDragInfo
  /** That drag ended at its release (Motion's `onDragEnd`). */
  readonly dragEnd: WardDragInfo
  /**
   * The drag's release came to rest on its own (Motion's `onDragTransitionEnd`, #273): its momentum
   * or its spring back, or at once for one released in place. Not for one a grab stopped.
   */
  readonly dragTransitionEnd: undefined
  /**
   * A pan's session began: a primary pointer went down on the element (Motion's
   * `onPanSessionStart`, #273). A pan moves nothing; once started, it counts as a drag for the
   * element's press and hover (ADR-0047). It sets no `touch-action`: give the element one for touch.
   */
  readonly panSessionStart: WardPointInfo
  /** That pan started, past its threshold (Motion's `onPanStart`). */
  readonly panStart: WardDragInfo
  /** That pan moved: its start and each move after (Motion's `onPan`). */
  readonly pan: WardDragInfo
  /** That pan ended at its release, or was cancelled (Motion's `onPanEnd`). Only a pan that started. */
  readonly panEnd: WardDragInfo
  /**
   * A layout animation of the element started, at the frame it takes its first step, after that
   * frame is painted (Motion's `onLayoutAnimationStart`, ADR-0039). A restart starts again.
   */
  readonly layoutStart: undefined
  /**
   * A layout animation of the element landed on its own (Motion's `onLayoutAnimationComplete`): not
   * one a restart interrupted, a window resize finished early, or an unmount cut off.
   */
  readonly layoutComplete: undefined
}

/** What `next(name)` waits for. */
export type WardEvent = keyof WardEvents

/** The `AbortError`'s message for a `next` the ward's disposal cut off. */
const GONE = "The ward was disposed before its next event."

/** A gesture whose recognizer the ward runs only once wanted (#87, #257, #273). */
export type WantedGesture = "hover" | "press" | "pan"

/** The gesture whose recognizer an event needs: `next("tap")` needs the press one running. */
const GESTURE_OF: Partial<Record<WardEvent, WantedGesture>> = {
  hoverStart: "hover",
  hoverEnd: "hover",
  pressStart: "press",
  tap: "press",
  tapCancel: "press",
  panSessionStart: "pan",
  panStart: "pan",
  pan: "pan",
  panEnd: "pan",
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
  private landedPrevious: string | undefined = undefined
  private last: WardSettled | undefined = undefined
  // Made at the first read: the setter of the count it tracks, its memo, and its pending read's resolver.
  private setCount: ((count: number) => void) | undefined = undefined
  private memo: Accessor<WardSettled | undefined> | undefined = undefined
  private waiting: ((landing: WardSettled) => void) | undefined = undefined
  // The `next(name)` calls waiting, made at the first; and whether the ward is gone.
  private events: Waiters<WardEvents> | undefined = undefined
  private disposed = false
  // The gestures a `next` has asked for, whose recognizers the ward runs from then on.
  private hover = false
  private press = false
  private pan = false
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

  started(resolution: Resolution): void {
    this.starts++
    this.flying = resolution
    if (Predicate.isNotUndefined(this.setCount)) this.setCount(this.starts)
  }

  settled(resolution: Resolution, previous: string | undefined): void {
    // A landing told after a later Retarget started (a settle waits for the gate's flush) is stale.
    if (resolution !== this.flying) return
    this.landed = this.starts
    this.landedResolution = resolution
    this.landedPrevious = previous
    this.last = undefined
    const resolve = this.waiting
    if (Bool.and(Predicate.isUndefined(resolve), Predicate.isUndefined(this.events))) return
    this.waiting = undefined
    if (Predicate.isNotUndefined(resolve)) resolve(this.lastLanding() as WardSettled)
    this.tell("settled", this.landing)
  }

  /** A hover's start or end (#257). */
  hovered(transition: Recognizer.Transition): void {
    if (Predicate.isUndefined(this.events)) return
    this.tell(Bool.match(transition.active, { onTrue: (): WardEvent => "hoverStart", onFalse: () => "hoverEnd" }), () => pointInfoOf(transition.event))
  }

  /** A press's start or end (#257): a press a drag took over tells nothing. */
  pressed(press: Recognizer.PressEvent): void {
    if (Predicate.isUndefined(this.events)) return
    const name = PRESS_EVENT[press.phase]
    if (Predicate.isUndefined(name)) return
    this.tell(name, () => pointInfoOf(press.event))
  }

  /** A drag's sample (#257, #273): its start, each move (its start among them) and its end are told. */
  dragged(sample: Drag.Sample): void {
    this.moved(DRAG_EVENT[sample.phase], "drag", sample)
  }

  /** A pan's sample (#273): its session's start, then as a drag's. */
  panned(sample: Recognizer.PanSample): void {
    if (Predicate.isUndefined(this.events)) return
    if (sample.phase === "session") {
      this.tell("panSessionStart", () => pointOfSample(sample))
      return
    }
    this.moved(PAN_EVENT[sample.phase], "pan", sample as Drag.Sample)
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

  /** A drag's or a pan's sample past a pan's session's start: its start's or end's event (`named`), then `every` at its start and each move. */
  private moved(named: MovementEvent | undefined, every: "drag" | "pan", sample: Drag.Sample): void {
    if (Predicate.isUndefined(this.events)) return
    const info = (): WardDragInfo => dragInfoOf(sample)
    if (Predicate.isNotUndefined(named)) this.tell(named, info)
    if (sample.phase !== "end") this.tell(every, info)
  }

  /** Resolve the `next(name)` calls waiting, with `value()`, made once there are any. */
  private tell<E extends WardEvent>(name: E, value: () => WardEvents[E]): void {
    UndefinedOr.map(this.events, (events) => events.tell(name, value))
  }

  /** The last landing, for {@link tell}. */
  private readonly landing = (): WardSettled => this.lastLanding() as WardSettled

  /** `settled()`: the last landing, made reactive at the first read. */
  read(): WardSettled | undefined {
    if (Predicate.isUndefined(this.memo)) this.memo = runWithOwner(this.owner, () => this.makeMemo())
    return this.memo()
  }

  /**
   * `next(name)`: a promise of the next `name` after the call. A gesture's event starts that
   * gesture's recognizer, if the ward doesn't run it already.
   */
  wait<E extends WardEvent>(name: E): Promise<WardEvents[E]> {
    if (Predicate.isUndefined(this.events)) {
      this.events = new Waiters<WardEvents>(GONE)
      if (this.disposed) this.events.dispose()
    }
    const waited = this.events.wait(name)
    const gesture = GESTURE_OF[name]
    if (Bool.and(Predicate.isNotUndefined(gesture), Bool.not(this.disposed))) this.wanted(gesture as WantedGesture)
    return waited
  }

  /**
   * `each(name)`: every `name` from the call on, as an async iterable (#257): each step is a
   * {@link wait}, so one that comes while the loop's body runs is missed, as a `next` asked later
   * would miss it. It ends, rather than rejecting, once the ward is disposed.
   */
  each<E extends WardEvent>(name: E): AsyncIterable<WardEvents[E]> {
    return eachOf<WardEvents, E>(this, name)
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
      gestures: { hover: active.hovered, tap: active.pressed, drag: active.dragged },
    }
    return this.last
  }

  // The count of starts it tracks starts at the landed count, so its first read is never pending. A
  // Retarget in flight at that read is set from a microtask: a change in flight from there
  // (`isPending`), which a write in the read's own flush wouldn't be (Solid applies it there).
  private makeMemo(): Accessor<WardSettled | undefined> {
    const [count, set] = createSignal(this.landed)
    this.setCount = set
    const memo = createMemo((): WardSettled | undefined | PromiseLike<WardSettled> => {
      if (count() === this.landed) return this.lastLanding()
      return new Promise<WardSettled>((resolve) => {
        this.waiting = resolve
      })
    }, CLIENT_ONLY)
    if (this.starts !== this.landed) queueMicrotask(() => set(this.starts))
    return memo
  }
}
