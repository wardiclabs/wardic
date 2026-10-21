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
 * Nothing Solid is made until `settled` is first read: until then a start and a landing are counts
 * and a reference, so a ward no one asks costs no signal and no memo.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import { type Accessor, createMemo, createSignal, onCleanup, type Owner, runWithOwner } from "solid-js"
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

/** A ward's lifecycle: the spine's hooks, and what the ward hands over. */
export interface Lifecycle {
  readonly hooks: AnimationHooks
  readonly settled: Accessor<WardSettled | undefined>
  readonly next: (name: WardEvent) => Promise<WardSettled>
}

interface Waiter {
  readonly resolve: (landing: WardSettled) => void
  readonly reject: (reason: DOMException) => void
}

const NO_GESTURES: WardGestures = { hover: false, tap: false, drag: false }

/** The rejection of a `next` the ward's disposal cut off. */
const aborted = (): DOMException => new DOMException("The ward was disposed before its next landing.", "AbortError")

/**
 * Make a ward's lifecycle, under its `owner`: `gesturesNow` reads its gesture layers as a Retarget
 * starts. Its `next` calls are rejected when the owner is disposed.
 */
export const makeLifecycle = (owner: Owner | null, gesturesNow: () => WardGestures): Lifecycle => {
  // The Retargets started and the last one landed, counted.
  let started = 0
  let landed = 0
  // The Retarget in flight, and the gesture layers on as it started.
  let flying: Resolution | undefined
  let flyingGestures = NO_GESTURES
  // The last landing, built when it's asked for: its resolution, the variant before it, its gestures.
  let landedResolution: Resolution | undefined
  let landedPrevious: string | undefined
  let landedGestures = NO_GESTURES
  let last: WardSettled | undefined
  // Made at the first read of `settled`: the setter of the count it tracks, and its pending read's resolver.
  let setCount: ((count: number) => void) | undefined
  let waiting: ((landing: WardSettled) => void) | undefined
  let accessor: Accessor<WardSettled | undefined> | undefined
  // The `next("settled")` calls waiting, and whether the ward is gone.
  let nexts: Array<Waiter> = []
  let disposed = false

  const lastLanding = (): WardSettled | undefined => {
    if (Predicate.isNotUndefined(last) || Predicate.isUndefined(landedResolution)) return last
    last = { definition: definitionOf(landedResolution, landedPrevious) as WardicAnimationDefinition, target: landedResolution.resolved, gestures: landedGestures }
    return last
  }

  const hooks: AnimationHooks = {
    started: (resolution) => {
      started++
      flying = resolution
      flyingGestures = gesturesNow()
      if (Predicate.isNotUndefined(setCount)) setCount(started)
    },
    settled: (resolution, previous) => {
      // A landing told after a later Retarget started (a settle waits for the gate's flush) is stale.
      if (resolution !== flying) return
      landed = started
      landedResolution = resolution
      landedPrevious = previous
      landedGestures = flyingGestures
      last = undefined
      if (Predicate.isUndefined(waiting) && nexts.length === 0) return
      const landing = lastLanding() as WardSettled
      const resolve = waiting
      waiting = undefined
      if (Predicate.isNotUndefined(resolve)) resolve(landing)
      const due = nexts
      nexts = []
      Arr.forEach(due, (waiter) => waiter.resolve(landing))
    },
  }

  // The count of starts it tracks starts at the landed count, so its first read is never pending. A
  // Retarget in flight at that read is set from a microtask: a change in flight from there
  // (`isPending`), which a write in the read's own flush wouldn't be (Solid applies it there).
  const makeSettled = (): Accessor<WardSettled | undefined> => {
    const [count, set] = createSignal(landed)
    setCount = set
    const memo = createMemo((): WardSettled | undefined | PromiseLike<WardSettled> => {
      if (count() === landed) return lastLanding()
      return new Promise<WardSettled>((resolve) => {
        waiting = resolve
      })
    }, CLIENT_ONLY)
    if (started !== landed) queueMicrotask(() => set(started))
    return memo
  }

  const settled = (): WardSettled | undefined => {
    if (Predicate.isUndefined(accessor)) accessor = runWithOwner(owner, makeSettled)
    return accessor()
  }

  const next = (_name: WardEvent): Promise<WardSettled> =>
    new Promise<WardSettled>((resolve, reject) => {
      if (disposed) return reject(aborted())
      nexts.push({ resolve, reject })
    })

  onCleanup(() => {
    disposed = true
    const due = nexts
    nexts = []
    Arr.forEach(due, (waiter) => waiter.reject(aborted()))
  })

  return { hooks, settled, next }
}
