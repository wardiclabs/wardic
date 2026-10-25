/**
 * An ordered outbox for a feed that emits from inside its own callbacks (#318): `push` queues an
 * event, and `flush` emits every queued one, in order, once the caller's state is consistent. The
 * Held pointer (`InputSource.heldPointer`) pushes while it updates a hold and flushes after, so a
 * consumer never sees a hold half-updated.
 *
 * A flush from inside an emit (a consumer's handler that makes the platform dispatch again) returns
 * at once and leaves its events queued: the outer flush goes on with them, in order, as a `Queue`'s
 * one taker took them before (#318). A consumer that throws leaves the rest queued for the next flush.
 */
import { constVoid } from "effect/Function"
import * as Option from "effect/Option"

export interface Outbox<A> {
  readonly push: (event: A) => void
  readonly flush: () => void
}

export const make = <A>(emit: (event: A) => void): Outbox<A> => {
  const queued: Array<A> = []
  let flushing = false
  /** Emit the oldest queued event, then the rest. */
  const drain = (): void =>
    Option.match(Option.fromUndefinedOr(queued.shift()), {
      onNone: constVoid,
      onSome: (event) => {
        emit(event)
        drain()
      },
    })
  return {
    push: (event) => {
      queued.push(event)
    },
    flush: () => {
      if (flushing) return
      flushing = true
      try {
        drain()
      } finally {
        flushing = false
      }
    },
  }
}
