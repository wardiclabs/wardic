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
 * - {@link watch} and {@link watchWith}: a feed subscribed while a Scope is open, each event handled
 *   inside its emit, with no fiber and no Stream (#318, #379). The recognizers' watches fold events
 *   over them; a binding watches a feed it doesn't fold (a drag track's grabs, a Reorder item's keys).
 *
 * Tier 2 (ADR-0008), for Environment authors. Nothing here names a DOM type.
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"

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

/**
 * Where a watch hands a throw from its handler (#318, ADR-0055): core reports nothing (ADR-0030,
 * decision 4), so a binding passes its own, and the watch goes on with the next event. With none, the
 * throw goes up the platform's dispatch.
 */
export type OnDefect = (cause: Cause.Cause<never>) => void

/**
 * A watch's handlers (#318): `on`, each event or value, inside the event's dispatch; `onDefect`, a
 * throw from the handler (else it goes up the dispatch); `onEnd`, the feed ran out (a test's script).
 */
export interface Handlers<A> {
  readonly on: (value: A) => void
  readonly onDefect?: OnDefect | undefined
  readonly onEnd?: (() => void) | undefined
}

/** `handle`, a throw from it handed to `onDefect` when there is one. */
const guarded = <A>(handle: (event: A) => void, onDefect: OnDefect | undefined): ((event: A) => void) =>
  UndefinedOr.match(onDefect, {
    onUndefined: () => handle,
    onDefined: (defect) => (event: A): void => {
      try {
        handle(event)
      } catch (error) {
        defect(Cause.die(error))
      }
    },
  })

/**
 * Watch `feed` while the Scope is open (#318, #379): `make` makes this subscription's handler, which
 * hears each event inside its emit, with no fiber and no Stream, and returns whether to go on: `false`
 * stops the subscription (a recognizer's `once`), even from inside the feed's start. A throw from it
 * goes to `handlers.onDefect`, and `handlers.onEnd` is told if the feed runs out. Closing the Scope
 * stops the feed.
 */
export const watchWith = <A>(
  feed: InputFeed<A>,
  make: () => (event: A) => boolean,
  handlers: Pick<Handlers<never>, "onDefect" | "onEnd">,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const handle = make()
      const done = MutableRef.make(false)
      const stopFeed = MutableRef.make(constVoid)
      const finish = (): void => {
        if (MutableRef.get(done)) return
        MutableRef.set(done, true)
        MutableRef.get(stopFeed)()
      }
      const stop = feed(
        guarded((event: A) => {
          if (MutableRef.get(done)) return
          if (Bool.not(handle(event))) finish()
        }, handlers.onDefect),
        () => {
          if (MutableRef.get(done)) return
          UndefinedOr.map(handlers.onEnd, (onEnd) => onEnd())
        },
      )
      // Finished while the feed started (a script that ran out at once): stopped now.
      Bool.match(MutableRef.get(done), { onTrue: stop, onFalse: () => MutableRef.set(stopFeed, stop) })
      return finish
    }),
    (finish) => Effect.sync(finish),
  ).pipe(Effect.asVoid)

/**
 * Watch `feed` while the Scope is open (#379): `handlers.on` hears each event inside its emit, as
 * {@link watchWith}'s handler does, for a feed a binding doesn't fold (a drag track's grabs, a Reorder
 * item's keys). Tier 2, for bindings.
 */
export const watch = <A>(feed: InputFeed<A>, handlers: Handlers<A>): Effect.Effect<void, never, Scope.Scope> => {
  const on = handlers.on
  return watchWith(
    feed,
    () => (event) => {
      on(event)
      return true
    },
    handlers,
  )
}
