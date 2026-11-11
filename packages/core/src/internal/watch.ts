/**
 * What every recognizer's watch is built on (#318, ADR-0055; #548): a watch's run over an Input feed,
 * and a watch as a Stream. Shared by `Recognizer` and `DragRecognizer`, so neither imports the other.
 */
import * as Effect from "effect/Effect"
import { constFalse } from "effect/Function"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import * as InputFeed from "../InputFeed.ts"
import { tracedScoped } from "./tracing.ts"

/**
 * A watch's run (#318): `feed` watched while the Scope is open (`InputFeed.watchWith`), each event
 * handled inside its dispatch by a handler `makeHandle` makes for this subscription, with no fiber and
 * no Stream. Its span lasts as long (`Effect.withSpanScoped`), and its log is at the start, as a
 * Stream recognizer's were at subscribe. A handler returns whether to go on: `false` stops the
 * subscription (`once`).
 */
export const watchFeed = <Ev>(
  span: string,
  attributes: Record<string, unknown>,
  feed: InputFeed.InputFeed<Ev>,
  makeHandle: () => (event: Ev) => boolean,
  handlers: Pick<InputFeed.Handlers<never>, "onDefect" | "onEnd">,
): Effect.Effect<void, never, Scope.Scope> =>
  tracedScoped(
    Effect.logDebug(`${span}: watch`).pipe(
      Effect.andThen(InputFeed.watchWith(feed, makeHandle, handlers)),
      Effect.annotateLogs(attributes),
    ),
    span,
    { attributes },
  )

/**
 * A watch as a Stream (#318): each value offered and flushed inside the dispatch (ADR-0032), the
 * Stream ended when the feed runs out, or after the first value `done` says ends it (`once`).
 */
export const streamOf = <A, R>(
  watch: (handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | R>,
  done: (value: A) => boolean = constFalse,
): Stream.Stream<A, never, Exclude<R, Scope.Scope>> =>
  Stream.callback<A, never, R>((queue) =>
    watch({
      on: (value) => {
        Queue.offerUnsafe(queue, value)
        Queue.flushUnsafe(queue)
        if (done(value)) Queue.endUnsafe(queue)
      },
      onEnd: () => {
        Queue.endUnsafe(queue)
      },
    })
  )

/** An InputSource's feed over many targets, or a defect naming it: an Environment without one can't watch many targets as one. */
// #665's PR 5; shared by the hover's, the press's and the drag's watches over many targets (#712).
export const amongFeed = <A>(feed: A | undefined, name: string): Effect.Effect<A> =>
  UndefinedOr.match(feed, {
    onUndefined: () => Effect.die(new Error(`wardic: the Environment's InputSource has no \`${name}\`, which a gesture over many targets needs`)),
    onDefined: Effect.succeed,
  })

/** A watch's handlers over many targets: `on`, each target's start and end, with the target. */
// #665's PR 5 (Q56).
export interface AmongHandlers<A> extends Pick<InputFeed.Handlers<never>, "onDefect" | "onEnd" | "onStop"> {
  readonly on: (target: unknown, value: A) => void
}
