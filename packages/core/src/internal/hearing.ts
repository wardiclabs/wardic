/**
 * A subscriber's hearing: its own Stream, fed by plain calls. `hear` hands it a value and `end` ends it,
 * or fails it with its source's failure. A consumer waiting on the Stream is resumed inside the call, as a
 * `PubSub`'s subscriber was, never through the Effect scheduler (ADR-0017, decision 3), and a busy one
 * takes everything handed since, together, at its next pull.
 */
// #518, ADR-0067 *Amendment (#518)*, decision 3: under `Clock.ticks` and `SharedSource`, where a `PubSub` per
// source put its code in every app. Not a `Queue`: its offer schedules a release of its takers on the
// scheduler, a task a frame, even when they're released at once.
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"

export interface Hearing<A> {
  /** Hands the Stream `a`. */
  readonly hear: (a: A) => void
  /** Ends the Stream after what it was handed: failed with `exit`'s failure, else ended. An interruption ends it. */
  readonly end: (exit: Exit.Exit<void>) => void
  /** What it was handed, in order, until its end. */
  readonly stream: Stream.Stream<A>
}

/** A pull's end: the source's failure, else the Stream's end. An interruption ends it. */
const endOf = (exit: Exit.Exit<void>): Effect.Effect<never, Cause.Done> => {
  if (Exit.isSuccess(exit)) return Cause.done()
  if (Cause.hasInterruptsOnly(exit.cause)) return Cause.done()
  return Effect.failCause(exit.cause)
}

/** A fresh hearing, handed nothing yet. */
export const make = <A>(): Hearing<A> => {
  let heard: Array<A> = []
  let ended: Option.Option<Exit.Exit<void>> = Option.none()
  // The waiting pull's settle, while one waits. Per tick on the Clock's: a statement check, no Option.
  let waiting: (() => boolean) | undefined
  const wake = (): void => {
    if (Predicate.isUndefined(waiting)) return
    const resume = waiting
    waiting = undefined
    resume()
  }
  const take: Effect.Effect<Arr.NonEmptyReadonlyArray<A>, Cause.Done> = Effect.callback((resume) => {
    // What it was handed since, or its end: whether there was either to resume with.
    const settle = (): boolean => {
      if (Arr.isReadonlyArrayNonEmpty(heard)) {
        const taken = heard
        heard = []
        resume(Effect.succeed(taken))
        return true
      }
      if (Option.isNone(ended)) return false
      resume(endOf(ended.value))
      return true
    }
    if (settle()) return
    waiting = settle
    return Effect.sync(() => {
      waiting = undefined
    })
  })
  return {
    hear: (a) => {
      heard.push(a)
      wake()
    },
    end: (exit) => {
      ended = Option.some(exit)
      wake()
    },
    stream: Stream.fromPull(Effect.succeed(take)),
  }
}
