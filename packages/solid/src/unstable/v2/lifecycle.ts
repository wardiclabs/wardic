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

/** What `next(name)` waits for. */
export type WardEvent = "settled"

interface Waiter {
  readonly resolve: (landing: WardSettled) => void
  readonly reject: (reason: DOMException) => void
}

/** The rejection of a `next` the ward's disposal cut off. */
const aborted = (): DOMException => new DOMException("The ward was disposed before its next landing.", "AbortError")

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
  // The `next("settled")` calls waiting, made at the first; and whether the ward is gone.
  private nexts: Array<Waiter> | undefined = undefined
  private disposed = false
  private readonly owner: Owner | null

  constructor(owner: Owner | null) {
    this.owner = owner
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
    const due = this.nexts
    if (Bool.and(Predicate.isUndefined(resolve), Predicate.isUndefined(due))) return
    const landing = this.lastLanding() as WardSettled
    this.waiting = undefined
    this.nexts = undefined
    if (Predicate.isNotUndefined(resolve)) resolve(landing)
    if (Predicate.isNotUndefined(due)) Arr.forEach(due, (waiter) => waiter.resolve(landing))
  }

  /** `settled()`: the last landing, made reactive at the first read. */
  read(): WardSettled | undefined {
    if (Predicate.isUndefined(this.memo)) this.memo = runWithOwner(this.owner, () => this.makeMemo())
    return this.memo()
  }

  /** `next("settled")`: a promise of the next landing after the call. */
  wait(_name: WardEvent): Promise<WardSettled> {
    return new Promise<WardSettled>((resolve, reject) => {
      if (this.disposed) return reject(aborted())
      if (Predicate.isUndefined(this.nexts)) this.nexts = []
      this.nexts.push({ resolve, reject })
    })
  }

  /** The ward is gone: every `next` waiting is rejected, and any asked later at once. */
  dispose(): void {
    this.disposed = true
    const due = this.nexts
    if (Predicate.isUndefined(due)) return
    this.nexts = undefined
    Arr.forEach(due, (waiter) => waiter.reject(aborted()))
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
