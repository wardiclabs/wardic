/**
 * What's in flight, as an async value (#433's Q8, #665): pending while any flight is on, its last
 * landing once none is, `undefined` before the first. `createAnimate`'s `scope.settled()` and
 * `createBatch`'s `settled()` read it, as a ward's `settled()` reads its lifecycle (ADR-0046).
 *
 * @module
 */
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createMemo, createSignal, getOwner, runWithOwner } from "solid-js"
import { CLIENT_ONLY } from "./solid-reactivity.ts"

/** Flights counted: each one's start and end, and the async value they make, read under its maker's owner. */
export interface Flights<L> {
  readonly started: () => void
  /** One flight ended, with its landing, or `undefined` for one that ended without landing. */
  readonly ended: (landing: L | undefined) => void
  readonly read: () => L | undefined
}

/** Flights made under the current owner: nothing Solid is made until the first read. */
export const flightsOf = <L>(): Flights<L> => {
  const owner = getOwner()
  let flying = 0
  let last: L | undefined
  let setCount: ((count: number) => void) | undefined
  let memo: Accessor<L | undefined> | undefined
  let waiting: ((landed: L | undefined) => void) | undefined
  const tell = (): void => {
    UndefinedOr.map(setCount, (set) => set(flying))
  }
  // Its count starts at none in flight, so its first read is never pending; one in flight then is
  // set from a microtask, as a ward's Retarget in flight is: a start comes in Solid's flush.
  const make = (): Accessor<L | undefined> => {
    const [count, set] = createSignal(0)
    setCount = set
    const made = createMemo((): L | undefined | PromiseLike<L | undefined> => {
      if (count() === 0) return last
      return new Promise<L | undefined>((resolve) => {
        waiting = resolve
      })
    }, CLIENT_ONLY)
    if (flying > 0) queueMicrotask(tell)
    return made
  }
  return {
    started: () => {
      flying++
      if (Predicate.isNotUndefined(setCount)) queueMicrotask(tell)
    },
    ended: (landing) => {
      flying--
      if (Predicate.isNotUndefined(landing)) last = landing
      if (flying > 0) return
      const resolve = waiting
      waiting = undefined
      UndefinedOr.map(resolve, (done) => done(last))
      tell()
    },
    read: () => {
      if (Predicate.isUndefined(memo)) memo = runWithOwner(owner, make)
      return (memo as Accessor<L | undefined>)()
    },
  }
}
