import { heldPointerSource, makePointerLikeEvent, type PointerFeed, type PointerLikeEvent } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"

// heldPointerSource (ADR-0019, decision 6a): the Environment-agnostic Held pointer
// contract, checked against fake feeds. A fake feed records its subscribe and
// unsubscribe calls and exposes `emit`, so a test pushes events by hand, each with
// a fresh `raw` object (the SAME `raw` to simulate one DOM event reaching both feeds).

type Emit = (event: PointerLikeEvent, raw: unknown) => void

const makeFeed = () => {
  let emit: Emit | undefined
  let subscribes = 0
  let unsubscribes = 0
  const feed: PointerFeed = (next) => {
    emit = next
    subscribes++
    return () => {
      unsubscribes++
      emit = undefined
    }
  }
  return {
    feed,
    subscribes: () => subscribes,
    unsubscribes: () => unsubscribes,
    subscribed: () => emit !== undefined,
    /** Push an event through the feed; a fresh `raw` unless one is given. */
    push: (event: PointerLikeEvent, raw: unknown = {}): void => {
      if (emit === undefined) throw new Error("feed is not subscribed")
      emit(event, raw)
    },
  }
}

type Feed = ReturnType<typeof makeFeed>

const ev = (init: Parameters<typeof makePointerLikeEvent>[0]): PointerLikeEvent => makePointerLikeEvent(init)

/** Let the stream's queued deliveries reach the collector (no timers, so deterministic). */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow
})

/** Run the stream into an array; resolves once it has subscribed `target`. */
const start = (target: Feed, global?: Feed) =>
  Effect.gen(function* () {
    const seen: Array<PointerLikeEvent> = []
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(heldPointerSource({ target: target.feed, global: global?.feed }), (event) =>
        Effect.sync(() => {
          seen.push(event)
        })),
    )
    yield* settle
    return { seen, fiber }
  })

const key = (event: PointerLikeEvent): string => `${event.type}${event.pointerId}@${event.x}`

describe("heldPointerSource", () => {
  it.effect("C5: target events pass through in order", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      // A down, a move and an up on the target, plus an enter/leave (never held-related).
      target.push(ev({ type: "enter", x: 1 }))
      target.push(ev({ type: "down", x: 2 }))
      target.push(ev({ type: "move", x: 3 }))
      target.push(ev({ type: "up", x: 4, buttons: 0 }))
      target.push(ev({ type: "leave", x: 5 }))
      yield* settle
      expect(seen.map(key)).toEqual(["enter1@1", "down1@2", "move1@3", "up1@4", "leave1@5"])
      yield* Fiber.interrupt(fiber)
    }))

  it.effect("C6: a target down subscribes global synchronously inside that emit", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { fiber } = yield* start(target, global)
      // Nothing is listening page-wide before a down, nor after a plain move.
      expect(global.subscribes()).toBe(0)
      target.push(ev({ type: "move" }))
      expect(global.subscribes()).toBe(0)
      target.push(ev({ type: "down" }))
      // Subscribed before `push` returned, with no yield in between.
      expect(global.subscribes()).toBe(1)
      yield* Fiber.interrupt(fiber)
    }))

  it.effect("C7: the same raw is delivered once, different raws with equal fields both are", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      target.push(ev({ type: "down" }))
      // One DOM event reaches the window (capture) first, then the target.
      const shared = {}
      global.push(ev({ type: "move", x: 10 }), shared)
      target.push(ev({ type: "move", x: 10 }), shared)
      // Two DOM events with equal fields but different raws.
      global.push(ev({ type: "move", x: 20 }), {})
      target.push(ev({ type: "move", x: 20 }), {})
      yield* settle
      // The shared raw once; the distinct raws both.
      expect(seen.map(key)).toEqual(["down1@0", "move1@10", "move1@20", "move1@20"])
      yield* Fiber.interrupt(fiber)
    }))

  it.effect("C8: global events of a pointer that is not held are dropped", () =>
    Effect.gen(function* () {
      // Pointer 1 is held.
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      target.push(ev({ type: "down", pointerId: 1 }))
      // Pointer 2 moves page-wide, then pointer 1 does.
      global.push(ev({ type: "move", pointerId: 2, x: 5 }), {})
      global.push(ev({ type: "up", pointerId: 2, x: 6, buttons: 0 }), {})
      global.push(ev({ type: "move", pointerId: 1, x: 7 }), {})
      yield* settle
      // Only the held pointer's event; pointer 2's up didn't release pointer 1.
      expect(seen.map(key)).toEqual(["down1@0", "move1@7"])
      expect(global.subscribed()).toBe(true)
      yield* Fiber.interrupt(fiber)
    }))

  describe("C9: the held pointer ends", () => {
    const ends: ReadonlyArray<{ readonly name: string; readonly end: () => PointerLikeEvent }> = [
      { name: "at its up", end: () => ev({ type: "up", x: 9, buttons: 0 }) },
      { name: "at its cancel", end: () => ev({ type: "cancel", x: 9, buttons: 0 }) },
      { name: "at a move with buttons 0", end: () => ev({ type: "move", x: 9, buttons: 0 }) },
    ]
    for (const { name, end: makeEnd } of ends) {
      it.effect(`C9: ${name}, delivered, with global unsubscribed synchronously`, () =>
        Effect.gen(function* () {
          const end = makeEnd()
          const target = makeFeed()
          const global = makeFeed()
          const { seen, fiber } = yield* start(target, global)
          target.push(ev({ type: "down" }))
          // A move that still has a button pressed doesn't end it.
          global.push(ev({ type: "move", x: 8, buttons: 1 }), {})
          expect(global.unsubscribes()).toBe(0)
          global.push(end, {})
          // Released with no yield in between.
          expect(global.unsubscribes()).toBe(1)
          expect(global.subscribed()).toBe(false)
          yield* settle
          expect(seen.map(key)).toEqual(["down1@0", "move1@8", `${end.type}1@9`])
          yield* Fiber.interrupt(fiber)
        }))
    }
  })

  it.effect("C10: two held pointers keep one global subscription until both end", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      // Two pointers go down.
      target.push(ev({ type: "down", pointerId: 1 }))
      target.push(ev({ type: "down", pointerId: 2 }))
      // One page-wide subscription.
      expect(global.subscribes()).toBe(1)
      // The first ends.
      global.push(ev({ type: "up", pointerId: 1, x: 1, buttons: 0 }), {})
      // Still subscribed for the second, which still flows.
      expect(global.unsubscribes()).toBe(0)
      global.push(ev({ type: "move", pointerId: 2, x: 2 }), {})
      // The second ends.
      global.push(ev({ type: "up", pointerId: 2, x: 3, buttons: 0 }), {})
      // Gone now, and never re-subscribed.
      expect(global.unsubscribes()).toBe(1)
      expect(global.subscribes()).toBe(1)
      yield* settle
      expect(seen.map(key)).toEqual(["down1@0", "down2@0", "up1@1", "move2@2", "up2@3"])
      yield* Fiber.interrupt(fiber)
    }))

  it.effect("C11: a down for an already-held pointer keeps one subscription and is delivered", () =>
    Effect.gen(function* () {
      // Pointer 1 is held and its release is lost.
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      target.push(ev({ type: "down", x: 1 }))
      // It goes down again.
      target.push(ev({ type: "down", x: 2 }))
      // No second subscription, both downs delivered, and it is still held.
      expect(global.subscribes()).toBe(1)
      expect(global.unsubscribes()).toBe(0)
      global.push(ev({ type: "move", x: 3 }), {})
      // A single release now ends the (once-counted) hold.
      global.push(ev({ type: "up", x: 4, buttons: 0 }), {})
      expect(global.unsubscribes()).toBe(1)
      yield* settle
      expect(seen.map(key)).toEqual(["down1@1", "down1@2", "move1@3", "up1@4"])
      yield* Fiber.interrupt(fiber)
    }))

  describe("C12: without global, and at the stream's end", () => {
    it.effect("C12: with no global, events pass through unchanged and interrupting unsubscribes target", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const { seen, fiber } = yield* start(target)
        const down = ev({ type: "down", x: 1 })
        const move = ev({ type: "move", x: 2 })
        const up = ev({ type: "up", x: 3, buttons: 0 })
        target.push(down)
        target.push(move)
        target.push(up)
        yield* settle
        // The very same event objects, in order; target stays subscribed while running.
        expect(seen).toEqual([down, move, up])
        expect(target.subscribes()).toBe(1)
        expect(target.unsubscribes()).toBe(0)
        yield* Fiber.interrupt(fiber)
        expect(target.unsubscribes()).toBe(1)
      }))

    it.effect("C12: interrupting while a pointer is held unsubscribes target and global", () =>
      Effect.gen(function* () {
        // A pointer is held, so global is subscribed.
        const target = makeFeed()
        const global = makeFeed()
        const { fiber } = yield* start(target, global)
        target.push(ev({ type: "down" }))
        expect(global.subscribed()).toBe(true)
        yield* Fiber.interrupt(fiber)
        // Both released exactly once.
        expect(target.unsubscribes()).toBe(1)
        expect(global.unsubscribes()).toBe(1)
      }))

    it.effect("C12: interrupting with nothing held never touches global", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const { fiber } = yield* start(target, global)
        yield* Fiber.interrupt(fiber)
        // Global was never subscribed nor unsubscribed.
        expect(target.unsubscribes()).toBe(1)
        expect(global.subscribes()).toBe(0)
        expect(global.unsubscribes()).toBe(0)
      }))
  })
})
