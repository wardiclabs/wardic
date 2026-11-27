/**
 * A watch's handler, guarded (#318, ADR-0055): a throw from it goes to the watch's `onDefect`, else, with
 * none, it's reported once a run of throws on the context the watch started in, and the watch goes on.
 * `InputFeed`'s watches and its `switched` are built on it, and Recognizer's keys, which hand `switched`
 * the context of the watch that opens them.
 */
// #979, row 27 (ADR-0074): with no `onDefect`, a throw went up the platform's dispatch, so a shared feed's
// later subscribers (a ward's own hover on the same element), a later node on the event's path and a later
// member missed the event. Every watch of Wardic's own passes an `onDefect`: this is for a Tier-2 caller's.
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { InputFeed, OnDefect, Switch } from "../InputFeed.ts"
import * as Report from "../unstable/Report.ts"

/** A watch's handler that threw, with no `onDefect` to take it. */
const HANDLER_FAILED = "wardic.input: a watch's handler failed"

/**
 * The context a watch with no `onDefect` reports on: the one it starts in, read only for such a watch.
 * `undefined` with an `onDefect`, which takes every throw.
 */
export const contextFor = (onDefect: OnDefect | undefined): Effect.Effect<Context.Context<never> | undefined> =>
  UndefinedOr.match(onDefect, { onDefined: () => Effect.succeed(undefined), onUndefined: () => Effect.context<never>() })

/**
 * `handle`, a throw from it handed to `onDefect` when there is one; with none, reported once a run of
 * throws on `context` (from its first throw to the next call that returns), and the next event heard.
 */
export const guarded = <A>(handle: (event: A) => void, onDefect: OnDefect | undefined, context: Context.Context<never> | undefined): ((event: A) => void) =>
  UndefinedOr.match(onDefect, {
    onDefined: (defect) => (event: A): void => {
      try {
        handle(event)
      } catch (error) {
        defect(Cause.die(error))
      }
    },
    onUndefined: () => {
      let failing = false
      return (event: A): void => {
        try {
          handle(event)
          if (failing) failing = false
        } catch (error) {
          if (!failing) Report.failureOn(context, HANDLER_FAILED, Cause.die(error))
          failing = true
        }
      }
    },
  })

/** `InputFeed.switched`, its handler guarded with `context` for a throw with no `onDefect`. */
export const switchedOn = <A>(feed: InputFeed<A>, handle: (event: A) => void, onDefect: OnDefect | undefined, context: Context.Context<never> | undefined): Switch => {
  const on = guarded(handle, onDefect, context)
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
