/**
 * Input feeds: a target's input as an Environment gives it, event by event, inside the platform's own
 * dispatch. A feed is a function: given `emit` and `end`, it calls `emit` with each event until the
 * function it returned stops it, and a source that runs out, as a test's script does, calls `end`.
 * `InputSource`'s pointer, keyboard and focus are feeds, and the recognizers are built on them.
 *
 * - **`watch`** handles a feed's events while a Scope is open, each inside its dispatch, so a handler
 *   can still prevent the platform's default. `watchWith` is its form for a handler that can stop.
 * - **`toStream`** gives a feed's events as a Stream, still inside the dispatch.
 * - **`byTarget`** shares one target's feed among everyone who subscribes to it, so hover, press and
 *   drag on one element start one source, not three.
 * - **`switched`** is a subscription its owner opens and closes, for a feed it needs only some of the
 *   time.
 *
 * @example
 * import * as InputFeed from "@wardic/core/InputFeed"
 *
 * const input = yield* InputSource.InputSource
 * yield* InputFeed.watch(input.keyboard(item), {
 *   on: (event) => {
 *     if (event.key === "escape") event.handle()
 *   },
 * })
 */
// #318, CONTEXT.md **Input feed**. `Probe.observeIntersection` is a feed too. `toStream` delivers
// inside the dispatch (ADR-0032). `byTarget` is a **Shared source** with no `PubSub` and no fiber, a
// ref-counted map; `SharedSource` still shares the Streams an Environment hands out (`Clock.ticks`,
// `Probe.observeResize`). `watch` and `watchWith` have no fiber and no Stream (#318, #379): the
// recognizers' watches fold events over them, and a binding watches a feed it doesn't fold (a drag
// track's grabs, a Reorder item's keys). `switched` is #460's. Tier 2 (ADR-0008), for Environment
// authors; nothing here names a DOM type.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * A source of events: called with `emit` and `end`, it calls `emit` with each event from then on, and
 * returns the function that stops it. A source that runs out calls `end` once, after its last.
 */
export type InputFeed<A> = (emit: (event: A) => void, end: () => void) => () => void

/** A feed with nothing to say: it never emits and never ends. */
export const empty: InputFeed<never> = () => constVoid

/**
 * `feed` as a Stream: each event is handed on inside its emit, so a consumer waiting on the Stream
 * handles it before the platform's dispatch returns, and a busy one takes it next, in order. The Stream
 * ends when the feed does, and stopping the Stream stops the feed.
 */
// #318; ADR-0032 (input inside the dispatch): each event offered and flushed inside its emit.
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
 * A feed per target, shared by its subscribers: `lookup(target)`'s feed starts with the first subscriber
 * and stops with the last, and every subscriber hears every event, in the order they subscribed. Hover,
 * press and drag on one target start one source, not three. A source that ends is dropped, so the next
 * subscriber starts it again.
 */
// #318, a **Shared source**. Keyed by identity (a `Map`): a target is never hashed, where
// `SharedSource`'s `RcMap` had to wrap a DOM node to keep from walking it. Copy on write: the subscriber
// list is replaced, never changed in place, so one that stops while an event goes round doesn't move
// the others.
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
 * Where a watch hands a throw from its handler, so a binding can report it its own way; the watch goes
 * on with the next event. With none, the throw goes up the platform's dispatch.
 */
// #318, ADR-0055. Core reports nothing (ADR-0030, decision 4).
export type OnDefect = (cause: Cause.Cause<never>) => void

/** A watch's handlers. */
// #318; `onStop` is #460's.
export interface Handlers<A> {
  /** Each event or value, inside the event's dispatch. */
  readonly on: (value: A) => void
  /** A throw from a handler. Without it, the throw goes up the platform's dispatch. */
  readonly onDefect?: OnDefect | undefined
  /** The feed ran out, as a test's script does. */
  readonly onEnd?: (() => void) | undefined
  /**
   * Once, when the watch stops: its Scope closed, or its handler done. For a watch that holds something
   * of its own beside the feed.
   */
  readonly onStop?: (() => void) | undefined
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

/** A subscription its owner opens and closes: `switched`'s. */
// #460.
export interface Switch {
  /** Starts the feed, unless it's running. */
  readonly open: () => void
  /** Stops the feed, unless it's stopped. */
  readonly close: () => void
}

/**
 * A subscription to `feed` its owner opens and closes, each event handed to `handle` inside its emit, a
 * throw to `onDefect`, as `watchWith`'s are. For a feed a watch needs only some of the time: a keyboard
 * press holds its target's keys only while focus is within it, so an element at rest holds none. The feed
 * running out ends nothing; its owner closes it when it's done.
 */
// #460: a **Keyboard press**.
export const switched = <A>(feed: InputFeed<A>, handle: (event: A) => void, onDefect?: OnDefect): Switch => {
  const on = guarded(handle, onDefect)
  let stop: (() => void) | undefined
  return {
    open: () => {
      if (Predicate.isUndefined(stop)) stop = feed(on, constVoid)
    },
    close: () => {
      if (Predicate.isUndefined(stop)) return
      const running = stop
      stop = undefined
      running()
    },
  }
}

/**
 * Watches `feed` while the Scope is open, with a handler that can stop: `make` makes this subscription's
 * handler, which hears each event inside its emit and returns whether to go on. `false` stops it, even
 * from inside the feed's start. A throw from it goes to `handlers.onDefect`, `handlers.onEnd` is told if
 * the feed runs out, and closing the Scope stops the feed.
 */
// #318, #379: no fiber and no Stream. A recognizer's `once` returns `false`.
export const watchWith = <A>(
  feed: InputFeed<A>,
  make: () => (event: A) => boolean,
  handlers: Pick<Handlers<never>, "onDefect" | "onEnd" | "onStop">,
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
        if (Predicate.isNotUndefined(handlers.onStop)) handlers.onStop()
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
 * Watches `feed` while the Scope is open: `handlers.on` hears each event inside its emit, so it can still
 * prevent the platform's default. For a binding's own input, where it needs no recognizer: a drag
 * track's grabs, a Reorder item's keys.
 */
// #379. Tier 2, for bindings.
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
