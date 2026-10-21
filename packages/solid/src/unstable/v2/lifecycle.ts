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
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import type * as Recognizer from "@wardic/core/Recognizer"
import { type Accessor, createMemo, createSignal, type Owner, runWithOwner } from "solid-js"
import type { WardicAnimationDefinition, WardicValues } from "../../config.ts"
import { type AnimationHooks, definitionOf, type Resolution } from "../../spine.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"

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
export interface WardPoint {
  readonly x: number
  readonly y: number
}

/** A hover's or a press's event (#257, Motion's `EventInfo` / `TapInfo`): where the pointer was, in the viewport. */
export interface WardPointInfo {
  readonly point: WardPoint
}

/**
 * A drag's start or end (#257, Motion's `PanInfo`): where the pointer was, in the viewport, and
 * the drag's `offset` from its down, its last `delta` and its `velocity` (px/s). A scroll during
 * the drag counts as movement in `offset`, as Motion's does; `point` stays where the pointer is
 * on the screen. A one-axis drag's are zeroed off its axis.
 */
export interface WardDragInfo {
  readonly point: WardPoint
  readonly offset: WardPoint
  readonly delta: WardPoint
  readonly velocity: WardPoint
}

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
  /** That drag ended at its release (Motion's `onDragEnd`). */
  readonly dragEnd: WardDragInfo
}

/** What `next(name)` waits for. */
export type WardEvent = keyof WardEvents

interface Waiter {
  readonly resolve: (value: never) => void
  readonly reject: (reason: DOMException) => void
}

/** The rejection of a `next` the ward's disposal cut off. */
const aborted = (): DOMException => new DOMException("The ward was disposed before its next event.", "AbortError")

/** The gesture whose recognizer an event needs: `next("tap")` needs the press one running. */
const GESTURE_OF: Partial<Record<WardEvent, "hover" | "press">> = {
  hoverStart: "hover",
  hoverEnd: "hover",
  pressStart: "press",
  tap: "press",
  tapCancel: "press",
}

/** Each press phase's event: a press a drag took over has none (Motion tells neither). */
const PRESS_EVENT: Record<Recognizer.PressPhase, WardEvent | undefined> = {
  start: "pressStart",
  tap: "tap",
  cancel: "tapCancel",
  dragged: undefined,
}

/** Each drag phase's event: a move has none. */
const DRAG_EVENT: Record<Drag.Sample["phase"], WardEvent | undefined> = {
  start: "dragStart",
  move: undefined,
  end: "dragEnd",
}

/** An event's point in the viewport: its `x`/`y` less the scroll its hold counted into them. */
const viewportOf = (event: InputSource.PointerLikeEvent): WardPoint => ({ x: event.x - event.scroll.x, y: event.y - event.scroll.y })

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
  // The `next(name)` calls waiting, by name, made at the first; and whether the ward is gone.
  private waiters: Map<WardEvent, Array<Waiter>> | undefined = undefined
  private disposed = false
  // The gestures a `next` has asked for, whose recognizers the ward runs from then on.
  private hover = false
  private press = false
  private readonly owner: Owner | null
  private readonly want: (gesture: "hover" | "press") => void

  /** `want` starts a gesture's recognizer on the mounted element the first time a `next` needs it. */
  constructor(owner: Owner | null, want: (gesture: "hover" | "press") => void) {
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
    if (Bool.and(Predicate.isUndefined(resolve), Predicate.isUndefined(this.waiters))) return
    this.waiting = undefined
    if (Predicate.isNotUndefined(resolve)) resolve(this.lastLanding() as WardSettled)
    this.tell("settled", this.landing)
  }

  /** A hover's start or end (#257). */
  hovered(transition: Recognizer.Transition): void {
    if (Predicate.isUndefined(this.waiters)) return
    this.tell(Bool.match(transition.active, { onTrue: (): WardEvent => "hoverStart", onFalse: () => "hoverEnd" }), () => ({ point: viewportOf(transition.event) }))
  }

  /** A press's start or end (#257): a press a drag took over tells nothing. */
  pressed(press: Recognizer.PressEvent): void {
    if (Predicate.isUndefined(this.waiters)) return
    const name = PRESS_EVENT[press.phase]
    if (Predicate.isUndefined(name)) return
    this.tell(name, () => ({ point: viewportOf(press.event) }))
  }

  /** A drag's sample (#257): its start and its end are told. */
  dragged(sample: Drag.Sample): void {
    if (Predicate.isUndefined(this.waiters)) return
    const name = DRAG_EVENT[sample.phase]
    if (Predicate.isUndefined(name)) return
    this.tell(name, () => ({
      point: { x: sample.point.x - sample.scroll.x, y: sample.point.y - sample.scroll.y },
      offset: sample.offset,
      delta: sample.delta,
      velocity: sample.velocity,
    }))
  }

  /** Resolve the `next(name)` calls waiting, with `value()`, made once there are any. */
  private tell(name: WardEvent, value: () => unknown): void {
    const waiters = this.waiters
    if (Predicate.isUndefined(waiters)) return
    const due = waiters.get(name)
    if (Predicate.isUndefined(due)) return
    waiters.delete(name)
    const told = value() as never
    Arr.forEach(due, (waiter) => waiter.resolve(told))
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
    return new Promise<WardEvents[E]>((resolve, reject) => {
      if (this.disposed) return reject(aborted())
      if (Predicate.isUndefined(this.waiters)) this.waiters = new Map()
      const waiters = this.waiters
      const waiter: Waiter = { resolve: resolve as (value: never) => void, reject }
      UndefinedOr.match(waiters.get(name), {
        onUndefined: () => waiters.set(name, [waiter]),
        onDefined: (waiting) => waiting.push(waiter),
      })
      const gesture = GESTURE_OF[name]
      if (Predicate.isNotUndefined(gesture)) this.wanted(gesture)
    })
  }

  /** The ward is gone: every `next` waiting is rejected, and any asked later at once. */
  dispose(): void {
    this.disposed = true
    const waiters = this.waiters
    if (Predicate.isUndefined(waiters)) return
    this.waiters = undefined
    waiters.forEach((due) => Arr.forEach(due, (waiter) => waiter.reject(aborted())))
  }

  /** A gesture a `next` needs: its recognizer is started the first time. */
  private wanted(gesture: "hover" | "press"): void {
    const hover = gesture === "hover"
    if (Bool.match(hover, { onTrue: () => this.hover, onFalse: () => this.press })) return
    this.hover = Bool.or(this.hover, hover)
    this.press = Bool.or(this.press, Bool.not(hover))
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
