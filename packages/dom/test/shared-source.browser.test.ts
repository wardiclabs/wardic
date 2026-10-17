// Core's SharedSource keyed by a real DOM element (#37; core's own tests are
// packages/core/test/shared-source.test.ts, SS1–SS8).
//
// - SSD1: a lone first subscriber keyed by a DOM element runs the lookup and receives its events.
//   Effect's structural `Hash` throws on a DOM node (it touches a function's `.caller` in strict
//   mode); before `SharedSource` keyed targets by identity, the throw killed the subscriber, so the
//   lookup never ran and no event flowed. Core's SS2 pins the same with a throwing getter.
import * as SharedSource from "@wardic/core/SharedSource"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

/** Let the scheduler run a few rounds, so a subscription is live or a publish has drained. */
const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

describe("SharedSource.byTarget in a browser (#37)", () => {
  it.effect("SSD1: a lone first subscriber keyed by a DOM element runs the lookup and receives its events", () =>
    Effect.gen(function* () {
      const acquired = yield* Ref.make(0)
      const pubsub = yield* PubSub.unbounded<number>()
      const shared = yield* SharedSource.byTarget(() =>
        Ref.update(acquired, (n) => n + 1).pipe(Effect.as(Stream.fromPubSub(pubsub))),
      )
      const received = yield* Ref.make<ReadonlyArray<number>>([])
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(shared(document.createElement("div")), (n) => Ref.update(received, (xs) => [...xs, n])),
      )
      yield* drain
      expect(yield* Ref.get(acquired), "the lookup ran").toBe(1)
      yield* PubSub.publish(pubsub, 7)
      yield* drain
      expect(yield* Ref.get(received)).toEqual([7])
      yield* Fiber.interrupt(fiber)
    }))
})
