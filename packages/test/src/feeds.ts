/**
 * The Test Environment's **Input feeds** (#318): a script replayed to each subscriber, and a hub a
 * test pushes into.
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"

/**
 * A fixed script as a feed: each subscriber hears every event as it subscribes, then the end. A
 * Stream over it (`InputFeed.toStream`) emits the script and ends, as `Stream.fromIterable` did; an
 * empty one ends at once. Not shared: each subscriber gets the whole script (tests address one
 * surface, and a consumer may read it twice).
 */
export const script =
  <A>(events: ReadonlyArray<A>): InputFeed.InputFeed<A> =>
  (emit, end) => {
    Arr.forEach(events, emit)
    end()
    return constVoid
  }

/** A live feed a test pushes into, and the push. */
export interface Hub<A> {
  readonly feed: InputFeed.InputFeed<A>
  readonly push: (event: A) => Effect.Effect<void>
}

/**
 * A live feed: every subscriber hears each event pushed after it subscribed, in the order they
 * subscribed. `push` doesn't yield (ADR-0032): a subscriber handles the event inside the push, as an
 * Environment's consumers handle a real event inside its dispatch.
 */
export const hub = <A>(): Hub<A> => {
  let subscribers: ReadonlyArray<(event: A) => void> = []
  return {
    feed: (emit) => {
      subscribers = Arr.append(subscribers, emit)
      return () => {
        subscribers = Arr.filter(subscribers, (s) => s !== emit)
      }
    },
    push: (event) => Effect.sync(() => Arr.forEach(subscribers, (emit) => emit(event))),
  }
}
