/**
 * `next(name)` and `each(name)` on Solid 2 (#257, ADR-0046): the waits a ward's lifecycle, a
 * presence handle and a Reorder group hand over, by event name.
 *
 * - A wait resolves with the next `name` told after it.
 * - A failure of `name` (#257 item 4: an animation that can't land) rejects its waits with the
 *   failure's error, and an `each` of it throws it, ending there.
 * - Disposal rejects every wait with a `DOMException` named `"AbortError"`, as Web Animations'
 *   `finished` does on a cancel, and any wait asked after it at once.
 * - An `each` is a wait per step, so an event that comes while its loop's body runs is missed, as a
 *   wait asked later would miss it; disposal ends it, rather than rejecting.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

interface Waiter {
  readonly resolve: (value: never) => void
  readonly reject: (reason: unknown) => void
}

/** What can be waited on by name: {@link Waiters}, or a source that does more at a wait (a ward starts a recognizer). */
export interface Waitable<Events> {
  readonly wait: <E extends keyof Events>(name: E) => Promise<Events[E]>
}

/** The waits for a source's events, by name: see the module. `gone` is the `AbortError`'s message. */
export class Waiters<Events> implements Waitable<Events> {
  // The waits, by name, made at the first; and whether the source is gone.
  private waits: Map<keyof Events, Array<Waiter>> | undefined = undefined
  private disposed = false
  private readonly gone: string

  constructor(gone: string) {
    this.gone = gone
  }

  /** A promise of the next `name` told after the call. */
  readonly wait = <E extends keyof Events>(name: E): Promise<Events[E]> =>
    new Promise<Events[E]>((resolve, reject) => {
      if (this.disposed) return reject(this.aborted())
      if (Predicate.isUndefined(this.waits)) this.waits = new Map()
      const waits = this.waits
      const waiter: Waiter = { resolve: resolve as (value: never) => void, reject }
      UndefinedOr.match(waits.get(name), {
        onUndefined: () => waits.set(name, [waiter]),
        onDefined: (waiting) => waiting.push(waiter),
      })
    })

  /** Resolve the waits for `name`, with `value()`, made once there are any. */
  tell<E extends keyof Events>(name: E, value: () => Events[E]): void {
    const waits = this.waits
    if (Predicate.isUndefined(waits)) return
    const due = waits.get(name)
    if (Predicate.isUndefined(due)) return
    waits.delete(name)
    const told = value() as never
    Arr.forEach(due, (waiter) => waiter.resolve(told))
  }

  /** `name` failed (#257 item 4): its waits are rejected with `error`. */
  fail<E extends keyof Events>(name: E, error: unknown): void {
    const waits = this.waits
    if (Predicate.isUndefined(waits)) return
    const due = waits.get(name)
    if (Predicate.isUndefined(due)) return
    waits.delete(name)
    Arr.forEach(due, (waiter) => waiter.reject(error))
  }

  /** The source is gone: every wait is rejected, and any asked later at once. */
  dispose(): void {
    this.disposed = true
    const waits = this.waits
    if (Predicate.isUndefined(waits)) return
    this.waits = undefined
    waits.forEach((due) => Arr.forEach(due, (waiter) => waiter.reject(this.aborted())))
  }

  private aborted(): DOMException {
    return new DOMException(this.gone, "AbortError")
  }
}

/** Whether a wait's rejection is its source's disposal: the `AbortError` {@link Waiters} rejects with. */
const isDisposal = (reason: unknown): boolean => Bool.and(reason instanceof DOMException, (reason as DOMException).name === "AbortError")

/** The end of an `each`. */
const ENDED: IteratorReturnResult<undefined> = { value: undefined, done: true }

/** Every `name` from `source` after the call, as an async iterable: see the module. */
export const eachOf = <Events, E extends keyof Events>(source: Waitable<Events>, name: E): AsyncIterable<Events[E]> => ({
  [Symbol.asyncIterator]: () => new Each(source, name),
})

/** An `each`'s iterator: each step the next `name`, the end once its source is disposed. */
class Each<Events, E extends keyof Events> implements AsyncIterator<Events[E], undefined> {
  private readonly source: Waitable<Events>
  private readonly name: E

  constructor(source: Waitable<Events>, name: E) {
    this.source = source
    this.name = name
  }

  next(): Promise<IteratorResult<Events[E], undefined>> {
    // Its source's disposal (its AbortError) ends the iteration; a failure (#257 item 4) is thrown.
    return this.source.wait(this.name).then(
      (value): IteratorResult<Events[E], undefined> => ({ value, done: false }),
      (reason: unknown) => Bool.match(isDisposal(reason), { onTrue: () => ENDED, onFalse: () => Promise.reject(reason) }),
    )
  }

  /** A `break` out of the loop: nothing waits between steps, so nothing is left behind. */
  return(): Promise<IteratorResult<Events[E], undefined>> {
    return Promise.resolve(ENDED)
  }
}

/** A server's `next`: nothing happens there, and nothing disposes it. */
export const neverLands = (): Promise<never> => new Promise<never>(() => {})

/** A server's `each`: nothing happens there, so it ends at once. */
export const NO_EVENTS: AsyncIterable<never> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(ENDED) }),
}
