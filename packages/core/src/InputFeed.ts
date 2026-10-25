/**
 * The `InputFeed` module (#318, CONTEXT.md **Input feed**): a target's input as an Environment gives
 * it. A feed, started with `emit` and `end`, calls `emit` with each event inside the platform's
 * dispatch until the function it returned stops it; a finite source (a test's script) calls `end`
 * after its last event. `InputSource`'s pointer, keyboard and focus, and `Probe.observeIntersection`,
 * are feeds.
 *
 * - {@link toStream}: the same events as a Stream, for a consumer that wants one, delivered inside
 *   the dispatch as a feed's are (ADR-0032).
 * - {@link byTarget}: a feed per target shared by its subscribers (a **Shared source**), with no
 *   `PubSub` and no fiber: a ref-counted map. `SharedSource` still shares the Streams an Environment
 *   hands out (`Clock.ticks`, `Probe.observeResize`).
 *
 * Tier 2 (ADR-0008), for Environment authors. Nothing here names a DOM type.
 */
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

/**
 * A source of events: called with `emit` and `end`, it starts calling `emit` with each event, and
 * returns the function that stops it. A source that runs out calls `end` once, after its last.
 */
export type InputFeed<A> = (emit: (event: A) => void, end: () => void) => () => void

/** A feed with nothing to say: it never emits and never ends. */
export const empty: InputFeed<never> = () => constVoid

/**
 * `feed` as a Stream (#318): each event offered and flushed inside its emit, so a consumer waiting
 * on the Stream handles it before the platform's dispatch returns (ADR-0032), and one that's busy
 * takes it next, in order. The Stream ends when the feed does; stopping the Stream stops the feed.
 */
export const toStream = <A>(feed: InputFeed<A>): Stream.Stream<A> =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        feed(
          (event) => {
            Queue.offerUnsafe(queue, event)
            Queue.flushUnsafe(queue)
          },
          () => {
            Queue.endUnsafe(queue)
          },
        )
      ),
      (stop) => Effect.sync(stop),
    )
  )

/** A subscriber of a shared feed. */
interface Subscriber<A> {
  readonly emit: (event: A) => void
  readonly end: () => void
}

/** A shared feed's running source: its subscribers, replaced as they come and go, and how to stop it. */
interface Entry<A> {
  subscribers: ReadonlyArray<Subscriber<A>>
  stop: () => void
}

/** Every subscriber hears `event`. */
const emitAll = <A>(subscribers: ReadonlyArray<Subscriber<A>>, event: A): void => Arr.forEach(subscribers, (s) => s.emit(event))

/** Every subscriber hears the end. */
const endAll = <A>(subscribers: ReadonlyArray<Subscriber<A>>): void => Arr.forEach(subscribers, (s) => s.end())

/**
 * A feed per target, shared by its subscribers (#318, a **Shared source**): `lookup(target)`'s feed
 * is started by the first subscriber and stopped when the last one stops, and every subscriber hears
 * every event, in the order they subscribed. A consumer folding hover, press and drag on one target
 * starts one source, not three.
 *
 * - **Keyed by identity** (a `Map`): a target is never hashed, where `SharedSource`'s `RcMap` had to
 *   wrap a DOM node to keep from walking it.
 * - **Copy on write:** the subscriber list is replaced, never changed in place, so one that stops
 *   while an event goes round doesn't move the others.
 * - **An ended source** is dropped: the next subscriber starts it again.
 */
export const byTarget = <A>(lookup: (target: unknown) => InputFeed<A>): ((target: unknown) => InputFeed<A>) => {
  const entries = new Map<unknown, Entry<A>>()
  /** Start `target`'s source for its first subscriber. Set before it starts, so what the start itself emits reaches it. */
  const start = (target: unknown, first: Subscriber<A>): Entry<A> => {
    const entry: Entry<A> = { subscribers: [first], stop: constVoid }
    entries.set(target, entry)
    entry.stop = lookup(target)(
      (event) => emitAll(entry.subscribers, event),
      () => {
        if (entries.get(target) === entry) entries.delete(target)
        endAll(entry.subscribers)
      },
    )
    return entry
  }
  return (target) => (emit, end) => {
    const subscriber: Subscriber<A> = { emit, end }
    const entry = Option.match(Option.fromUndefinedOr(entries.get(target)), {
      onNone: () => start(target, subscriber),
      onSome: (running) => {
        running.subscribers = Arr.append(running.subscribers, subscriber)
        return running
      },
    })
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      entry.subscribers = Arr.filter(entry.subscribers, (s) => s !== subscriber)
      if (Arr.isReadonlyArrayNonEmpty(entry.subscribers)) return
      if (entries.get(target) === entry) entries.delete(target)
      entry.stop()
    }
  }
}
