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
 * - A `when` (#355) is a browser-only memo of every `name` for an effect, through a listener that
 *   hears each one as it's told: see {@link whenOf}.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constUndefined, constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
// eslint-disable-next-line solid/removed-api -- Solid 2 rc.18 exports `from` and documents it (`solid-js/types/from.d.ts`); the plugin's list predates it
import { type Accessor, createMemo, from } from "solid-js"

interface Waiter {
  readonly resolve: (value: never) => void
  readonly reject: (reason: unknown) => void
}

/**
 * A listener to every `name` (#355): each one as it's told, and a failure. The source's end tells
 * it nothing: a `when` keeps its last value, or stays pending, until its owner is disposed.
 */
export interface Listener<A> {
  readonly next: (value: A) => void
  readonly error: (error: unknown) => void
}

/**
 * What can be waited on by name: {@link Waiters}, or a source that does more at a wait or a listen
 * (a ward starts a recognizer).
 */
export interface Waitable<Events> {
  readonly wait: <E extends keyof Events>(name: E) => Promise<Events[E]>
  /** Hear every `name` from now on (#355) until the returned stop or a failure. */
  readonly listen: <E extends keyof Events>(name: E, listener: Listener<Events[E]>) => () => void
}

/** The waits for a source's events, by name: see the module. `gone` is the `AbortError`'s message. */
export class Waiters<Events> implements Waitable<Events> {
  // The waits, by name, made at the first; the listeners (#355), made at the first; and whether the
  // source is gone.
  private waits: Map<keyof Events, Array<Waiter>> | undefined = undefined
  private listeners: Map<keyof Events, Set<Listener<never>>> | undefined = undefined
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

  /**
   * Hear every `name` from the call on (#355), until the returned stop or a failure of `name`. A
   * source that's gone hears nothing more.
   */
  readonly listen = <E extends keyof Events>(name: E, listener: Listener<Events[E]>): (() => void) => {
    if (this.disposed) return constVoid
    if (Predicate.isUndefined(this.listeners)) this.listeners = new Map()
    const listeners = this.listeners
    const heard = listener as Listener<never>
    UndefinedOr.match(listeners.get(name), {
      onUndefined: () => listeners.set(name, new Set([heard])),
      onDefined: (set) => set.add(heard),
    })
    return () => {
      UndefinedOr.map(listeners.get(name), (set) => set.delete(heard))
    }
  }

  /** Resolve the waits for `name` and tell its listeners, with `value()`, made once there are any. */
  tell<E extends keyof Events>(name: E, value: () => Events[E]): void {
    const due = this.takeWaits(name)
    const listening = this.listening(name)
    if (Bool.and(Predicate.isUndefined(due), Predicate.isUndefined(listening))) return
    const told = value() as never
    if (Predicate.isNotUndefined(due)) Arr.forEach(due, (waiter) => waiter.resolve(told))
    if (Predicate.isNotUndefined(listening)) listening.forEach((listener) => listener.next(told))
  }

  /** `name` failed (#257 item 4): its waits are rejected with `error`, and its listeners end with it. */
  fail<E extends keyof Events>(name: E, error: unknown): void {
    UndefinedOr.map(this.takeWaits(name), (due) => Arr.forEach(due, (waiter) => waiter.reject(error)))
    UndefinedOr.map(this.listeners, (listeners) => {
      const listening = listeners.get(name)
      listeners.delete(name)
      UndefinedOr.map(listening, (set) => set.forEach((listener) => listener.error(error)))
    })
  }

  /** The source is gone: every wait is rejected, and any asked later at once; its listeners let go. */
  dispose(): void {
    this.disposed = true
    this.listeners = undefined
    const waits = this.waits
    if (Predicate.isUndefined(waits)) return
    this.waits = undefined
    waits.forEach((due) => Arr.forEach(due, (waiter) => waiter.reject(this.aborted())))
  }

  /** `name`'s listeners, if it has any: a plain read, as `tell` runs at each drag sample. */
  private listening<E extends keyof Events>(name: E): Set<Listener<never>> | undefined {
    const listeners = this.listeners
    if (Predicate.isUndefined(listeners)) return undefined
    const set = listeners.get(name)
    if (Predicate.isUndefined(set)) return undefined
    if (set.size === 0) return undefined
    return set
  }

  /** The waits for `name`, taken: they're due now. */
  private takeWaits<E extends keyof Events>(name: E): Array<Waiter> | undefined {
    const waits = this.waits
    if (Predicate.isUndefined(waits)) return undefined
    const due = waits.get(name)
    waits.delete(name)
    return due
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

/**
 * `when(name)` (#355): every `name` from `source`, as a memo for an effect to act on.
 *
 * - **In the browser:** pending until the first `name`, so an effect over it runs at each one and
 *   never before; nothing else waits on it. It listens through Solid's `from`, so none is lost
 *   between steps, as `each`'s waits can lose one: several in one flush run its effect once, with
 *   the latest. `equals: false`, so an event with no value runs it each time.
 * - **On a server** ({@link serverWhen}): a browser-only memo (`ssrSource: "client"`), so nothing of
 *   it is serialized for the browser's to adopt, with a provisional `undefined` (`loadingValue`):
 *   Solid's server runs an effect's compute, never its function, and a browser-only memo read there
 *   outside a `<Loading>` is an error. No effect sees it.
 * - A failure of `name` (#257 item 4) errors it: an effect over it gets it in its `error` arm, or,
 *   with none, Solid logs it and skips the run. The source's end leaves it at its last value, or
 *   pending.
 *
 * Read it in an effect, not in JSX: a read in the ward's own markup waits on a gesture its region
 * holds back. Made where it's called, as `createMemo` is: call it in a component's body.
 */
export const whenOf = <Events, E extends keyof Events>(source: Waitable<Events>, name: E): Accessor<Events[E]> =>
  createMemo<Events[E]>(() => from<Events[E]>((next, error) => source.listen(name, { next, error })), { equals: false })

/** A server's `when` (#355): the browser-only memo, with a provisional `undefined` no effect sees. */
export const serverWhen = <A,>(): Accessor<A> => createMemo<A>(constUndefined as () => A, { ssrSource: "client", loadingValue: undefined as A })

/** A server's `next`: nothing happens there, and nothing disposes it. */
export const neverLands = (): Promise<never> => new Promise<never>(() => {})

/** A server's `each`: nothing happens there, so it ends at once. */
export const NO_EVENTS: AsyncIterable<never> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(ENDED) }),
}
