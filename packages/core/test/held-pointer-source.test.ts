import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import { describe, expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { MixedScheduler } from "effect/Scheduler"
import * as Stream from "effect/Stream"

// InputSource.heldPointer (ADR-0019, decision 6a): the Environment-agnostic Held pointer
// contract, checked against fake feeds. A fake feed records its subscribe and
// unsubscribe calls and exposes `emit`, so a test pushes events by hand, each with
// a fresh `raw` object (the SAME `raw` to simulate one DOM event reaching both feeds).

type Emit = (event: InputSource.PointerLikeEvent, raw: unknown) => void

const makeFeed = () => {
  let emit: Emit | undefined
  let subscribes = 0
  let unsubscribes = 0
  const feed: InputSource.PointerFeed = (next) => {
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
    push: (event: InputSource.PointerLikeEvent, raw: unknown = {}): void => {
      if (emit === undefined) throw new Error("feed is not subscribed")
      emit(event, raw)
    },
  }
}

type Feed = ReturnType<typeof makeFeed>

const ev = (init: Parameters<typeof InputSource.makePointerLikeEvent>[0]): InputSource.PointerLikeEvent => InputSource.makePointerLikeEvent(init)

/** Let the stream's queued deliveries reach the collector (no timers, so deterministic). */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow
})

type ScrollEmit = (source: unknown, position: { readonly x: number; readonly y: number }, timeStamp: number) => void

/**
 * A fake scroll feed (ADR-0019, *Amendment (Reorder)*): each source has a scroll
 * position; subscribing emits every source's current position at once (the baselines),
 * and `scrollTo` moves one and emits it while subscribed.
 */
const makeScrollFeed = (initial: ReadonlyArray<readonly [unknown, { readonly x: number; readonly y: number }]>) => {
  const positions = new Map(initial)
  let emit: ScrollEmit | undefined
  let subscribes = 0
  let unsubscribes = 0
  const feed = (next: ScrollEmit): (() => void) => {
    emit = next
    subscribes++
    for (const [source, position] of positions) next(source, position, 0)
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
    scrollTo: (source: unknown, x: number, y: number, timeStamp: number): void => {
      positions.set(source, { x, y })
      emit?.(source, { x, y }, timeStamp)
    },
  }
}

type ScrollFeedFake = ReturnType<typeof makeScrollFeed>

/** Run the stream into an array; resolves once it has subscribed `target`. */
const start = (target: Feed, global?: Feed, scroll?: ScrollFeedFake) =>
  Effect.gen(function* () {
    const seen: Array<InputSource.PointerLikeEvent> = []
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(InputFeed.toStream(InputSource.heldPointer({ target: target.feed, global: global?.feed, scroll: scroll?.feed })), (event) =>
        Effect.sync(() => {
          seen.push(event)
        })),
    )
    yield* settle
    return { seen, fiber }
  })

const key = (event: InputSource.PointerLikeEvent): string => `${event.type}${event.pointerId}@${event.x}`

describe("InputSource.heldPointer", () => {
  it.effect("C5: target events pass through in order", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      // A down, a move and an up on the target, plus an enter/leave (never held-related).
      target.push(ev({ type: "enter", x: 1 }))
      target.push(ev({ type: "down", x: 2 }))
      target.push(ev({ type: "move", x: 3 }))
      target.push(ev({ type: "up", x: 4, pressed: false }))
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
      global.push(ev({ type: "up", pointerId: 2, x: 6, pressed: false }), {})
      global.push(ev({ type: "move", pointerId: 1, x: 7 }), {})
      yield* settle
      // Only the held pointer's event; pointer 2's up didn't release pointer 1.
      expect(seen.map(key)).toEqual(["down1@0", "move1@7"])
      expect(global.subscribed()).toBe(true)
      yield* Fiber.interrupt(fiber)
    }))

  describe("C9: the held pointer ends", () => {
    const ends: ReadonlyArray<{ readonly name: string; readonly end: () => InputSource.PointerLikeEvent }> = [
      { name: "at its up", end: () => ev({ type: "up", x: 9, pressed: false }) },
      { name: "at its cancel", end: () => ev({ type: "cancel", x: 9, pressed: false }) },
      { name: "at an unpressed move", end: () => ev({ type: "move", x: 9, pressed: false }) },
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
          global.push(ev({ type: "move", x: 8, pressed: true }), {})
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
      global.push(ev({ type: "up", pointerId: 1, x: 1, pressed: false }), {})
      // Still subscribed for the second, which still flows.
      expect(global.unsubscribes()).toBe(0)
      global.push(ev({ type: "move", pointerId: 2, x: 2 }), {})
      // The second ends.
      global.push(ev({ type: "up", pointerId: 2, x: 3, pressed: false }), {})
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
      global.push(ev({ type: "up", x: 4, pressed: false }), {})
      expect(global.unsubscribes()).toBe(1)
      yield* settle
      expect(seen.map(key)).toEqual(["down1@1", "down1@2", "move1@3", "up1@4"])
      yield* Fiber.interrupt(fiber)
    }))

  it.effect("C13: a page-wide down from the held pointer ends its hold with an unpressed move at its last position", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      target.push(ev({ type: "down", x: 1 }))
      global.push(ev({ type: "move", x: 40 }), {})
      // The release is lost; the same pointer goes down elsewhere on the page.
      const elsewhere = {}
      global.push(ev({ type: "down", x: 200, timeStamp: 50 }), elsewhere)
      // Ended at once: an unpressed move at the last position, and global is released.
      expect(global.unsubscribes()).toBe(1)
      yield* settle
      expect(seen.map(key)).toEqual(["down1@1", "move1@40", "move1@40"])
      const ended = seen[2]!
      expect(ended.pressed).toBe(false)
      expect(ended.timeStamp).toBe(50)
      // A later down on the target itself holds it again (the page-wide feed is off by then).
      target.push(ev({ type: "down", x: 60 }))
      yield* settle
      expect(seen.map(key).slice(3)).toEqual(["down1@60"])
      expect(global.subscribed()).toBe(true)
      yield* Fiber.interrupt(fiber)
    }))

  it.effect("C14: a page-wide down from a new primary pointer of the same type ends a held primary pointer's hold", () =>
    Effect.gen(function* () {
      const target = makeFeed()
      const global = makeFeed()
      const { seen, fiber } = yield* start(target, global)
      const touch = (init: Omit<Parameters<typeof InputSource.makePointerLikeEvent>[0], "kind">) =>
        ev({ kind: "touch", ...init })
      target.push(touch({ type: "down", pointerId: 1, x: 1 }))
      global.push(touch({ type: "move", pointerId: 1, x: 30 }), {})
      // A second finger (not primary) and a mouse (another type) don't end it.
      global.push(touch({ type: "down", pointerId: 2, x: 90, primary: false }), {})
      global.push(ev({ type: "down", pointerId: 7, x: 90 }), {})
      expect(global.unsubscribes()).toBe(0)
      // A new primary touch means the first finger lifted: its hold ends.
      global.push(touch({ type: "down", pointerId: 3, x: 300 }), {})
      expect(global.unsubscribes()).toBe(1)
      yield* settle
      expect(seen.map(key)).toEqual(["down1@1", "move1@30", "move1@30"])
      expect(seen[2]!.pressed).toBe(false)
      expect(seen[2]!.kind).toBe("touch")
      yield* Fiber.interrupt(fiber)
    }))

  describe("C15-C23: a scroll during a hold moves the held pointer (ADR-0019, *Amendment (Reorder)*)", () => {
    const at = (event: InputSource.PointerLikeEvent): string => `${event.type}${event.pointerId}@${event.x},${event.y}`
    const page = { name: "page" }
    const list = { name: "list" }

    it.effect("C15: the scroll feed is subscribed only while a pointer is held, synchronously inside the down", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const scroll = makeScrollFeed([[page, { x: 0, y: 0 }]])
        const { fiber } = yield* start(target, global, scroll)
        expect(scroll.subscribes()).toBe(0)
        target.push(ev({ type: "move" }))
        expect(scroll.subscribes()).toBe(0)
        target.push(ev({ type: "down" }))
        expect(scroll.subscribes()).toBe(1)
        expect(global.subscribes()).toBe(1)
        yield* Fiber.interrupt(fiber)
        // With no global feed, the scroll feed still comes with the hold.
        const lone = makeFeed()
        const loneScroll = makeScrollFeed([[page, { x: 0, y: 0 }]])
        const second = yield* start(lone, undefined, loneScroll)
        lone.push(ev({ type: "down" }))
        expect(loneScroll.subscribes()).toBe(1)
        yield* Fiber.interrupt(second.fiber)
      }))

    it.effect("C16: the positions the feed reports on subscribe are baselines, not scrolls", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const scroll = makeScrollFeed([
          [page, { x: 0, y: 300 }],
          [list, { x: 0, y: 40 }],
        ])
        const { seen, fiber } = yield* start(target, makeFeed(), scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20"])
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C17: a scroll emits a move of the held pointer at its last point shifted by the scroll", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, makeFeed(), scroll)
        target.push(ev({ type: "down", x: 10, y: 20, timeStamp: 5 }))
        target.push(ev({ type: "move", x: 10, y: 20, timeStamp: 10 }))
        scroll.scrollTo(list, 0, 60, 40)
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20", "move1@10,20", "move1@10,80"])
        const moved = seen[2]!
        expect(moved.pressed).toBe(true)
        expect(moved.button).toBe("none")
        expect(moved.kind).toBe("mouse")
        expect(moved.primary).toBe(true)
        expect(moved.timeStamp).toBe(40)
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C18: after a scroll, the held pointer's later moves and its release arrive shifted too", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, global, scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        target.push(ev({ type: "move", x: 11, y: 21 }))
        scroll.scrollTo(list, 0, 60, 40)
        target.push(ev({ type: "move", x: 12, y: 22 }))
        global.push(ev({ type: "move", x: 14, y: 24 }), {})
        global.push(ev({ type: "up", x: 15, y: 25, pressed: false }), {})
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20", "move1@11,21", "move1@11,81", "move1@12,82", "move1@14,84", "up1@15,85"])
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C19: scrolls of two sources add up", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const scroll = makeScrollFeed([
          [page, { x: 0, y: 100 }],
          [list, { x: 0, y: 0 }],
        ])
        const { seen, fiber } = yield* start(target, makeFeed(), scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        target.push(ev({ type: "move", x: 10, y: 20 }))
        scroll.scrollTo(list, 0, 60, 30)
        scroll.scrollTo(page, 10, 130, 40)
        target.push(ev({ type: "move", x: 11, y: 21 }))
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20", "move1@10,20", "move1@10,80", "move1@20,110", "move1@21,111"])
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C20: the release unsubscribes the feed; the next hold starts from fresh baselines with no shift", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, global, scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        target.push(ev({ type: "move", x: 10, y: 20 }))
        scroll.scrollTo(list, 0, 60, 30)
        global.push(ev({ type: "up", x: 10, y: 20, pressed: false }), {})
        expect(scroll.unsubscribes()).toBe(1)
        // Scrolled again while nothing is held: not reported, and not a shift later.
        scroll.scrollTo(list, 0, 200, 50)
        target.push(ev({ type: "down", x: 30, y: 40 }))
        target.push(ev({ type: "move", x: 31, y: 41 }))
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20", "move1@10,20", "move1@10,80", "up1@10,80", "down1@30,40", "move1@31,41"])
        expect(scroll.subscribes()).toBe(2)
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C21: a scroll report with no change emits nothing", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 40 }]])
        const { seen, fiber } = yield* start(target, makeFeed(), scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        scroll.scrollTo(list, 0, 40, 30)
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20"])
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C22: with a scroll feed but no scroll, events pass through as the very same objects", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, makeFeed(), scroll)
        const down = ev({ type: "down", x: 1 })
        const move = ev({ type: "move", x: 2 })
        target.push(down)
        target.push(move)
        yield* settle
        expect(seen).toEqual([down, move])
        expect(seen[1]).toBe(move)
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C23: a lost release still ends at the shifted point (decision 7's move and rule A's)", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, global, scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        target.push(ev({ type: "move", x: 10, y: 20 }))
        scroll.scrollTo(list, 0, 60, 30)
        // The same pointer goes down elsewhere: the hold ends with an unpressed move at the
        // last (shifted) point.
        global.push(ev({ type: "down", x: 300, y: 300, timeStamp: 50 }), {})
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20", "move1@10,20", "move1@10,80", "move1@10,80"])
        expect(seen[3]!.pressed).toBe(false)
        // Rule A's end, an unpressed move from the feed, arrives shifted too.
        target.push(ev({ type: "down", x: 10, y: 20 }))
        target.push(ev({ type: "move", x: 10, y: 20 }))
        scroll.scrollTo(list, 0, 100, 60)
        global.push(ev({ type: "move", x: 12, y: 22, pressed: false }), {})
        yield* settle
        expect(seen.map(at).slice(4)).toEqual(["down1@10,20", "move1@10,20", "move1@10,60", "move1@12,62"])
        expect(seen.at(-1)!.pressed).toBe(false)
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C24: a scroll before the held pointer's first move emits nothing; that move carries it, and later scrolls emit moves", () =>
      Effect.gen(function* () {
        // Motion's pan session updates nothing until the first pointermove
        // (PanSession.ts:271-272 at 16c6122), so a press held still while the page
        // scrolls stays a press.
        const target = makeFeed()
        const global = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, global, scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        scroll.scrollTo(list, 0, 60, 30)
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20"])
        global.push(ev({ type: "move", x: 11, y: 21 }), {})
        scroll.scrollTo(list, 0, 70, 40)
        yield* settle
        expect(seen.map(at)).toEqual(["down1@10,20", "move1@11,81", "move1@11,91"])
        // A second down for the held pointer starts over: no move yet, no shift.
        target.push(ev({ type: "down", x: 30, y: 40 }))
        scroll.scrollTo(list, 0, 100, 50)
        target.push(ev({ type: "move", x: 31, y: 41 }))
        yield* settle
        expect(seen.map(at).slice(3)).toEqual(["down1@30,40", "move1@31,71"])
        yield* Fiber.interrupt(fiber)
      }))

    it.effect("C29: each shifted event, and a scroll's move, carries the scroll it counts; one not shifted, none (#257)", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, global, scroll)
        target.push(ev({ type: "down", x: 10, y: 20 }))
        target.push(ev({ type: "move", x: 11, y: 21 }))
        scroll.scrollTo(list, 0, 60, 40)
        global.push(ev({ type: "up", x: 15, y: 25, pressed: false }), {})
        yield* settle
        expect(seen.map((event) => event.scroll)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 60 }, { x: 0, y: 60 }])
        // Where the pointer was on the screen: its point less the scroll counted into it.
        const up = seen[3]!
        expect({ x: up.x - up.scroll.x, y: up.y - up.scroll.y }).toEqual({ x: 15, y: 25 })
        expect(seen[0]!.scroll, "not shifted: the shared zero").toBe(InputSource.NO_SCROLL)
        yield* Fiber.interrupt(fiber)
      }))
  })

  describe("C30: whether an event landed on the target (#257)", () => {
    it.effect("C30: a page-wide event keeps the onTarget its feed gave it; a lost release's ending move hasn't landed on it", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const { seen, fiber } = yield* start(target, global)
        target.push(ev({ type: "down", x: 1 }))
        global.push(ev({ type: "move", x: 40, onTarget: false }), {})
        global.push(ev({ type: "move", x: 41, onTarget: true }), {})
        // The release is lost; the same pointer goes down elsewhere on the page.
        global.push(ev({ type: "down", x: 200, timeStamp: 50 }), {})
        yield* settle
        expect(seen.map((event) => `${key(event)} ${event.onTarget}`)).toEqual(["down1@1 true", "move1@40 false", "move1@41 true", "move1@41 false"])
        yield* Fiber.interrupt(fiber)
      }))
  })

  describe("C31: the platform event a held pointer's own moves carry (#273)", () => {
    it.effect("C31: a scroll's move and a lost release's move carry the last move's raw (Motion's lastMoveEvent), not an enter's or a leave's; the down's before any move", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const global = makeFeed()
        const list = { name: "list" }
        const scroll = makeScrollFeed([[list, { x: 0, y: 0 }]])
        const { seen, fiber } = yield* start(target, global, scroll)
        const down = { name: "down" }
        const move = { name: "move" }
        target.push(ev({ type: "down", x: 10, raw: down }))
        target.push(ev({ type: "move", x: 11, raw: move }))
        // A scroll under the pointer: the browser's boundary events, then the scroll.
        target.push(ev({ type: "leave", x: 11, raw: { name: "leave" } }))
        target.push(ev({ type: "enter", x: 11, raw: { name: "enter" } }))
        scroll.scrollTo(list, 0, 60, 30)
        // The release is lost; the same pointer goes down elsewhere.
        global.push(ev({ type: "down", x: 200, raw: { name: "down again" } }), {})
        yield* settle
        expect(seen.map((event) => `${event.type} ${(event.raw as { readonly name: string }).name}`)).toEqual([
          "down down",
          "move move",
          "leave leave",
          "enter enter",
          "move move",
          "move move",
        ])
        expect(seen[4]!.raw, "the very event").toBe(move)
        // A hold that never moved: its lost release's move carries the down's.
        target.push(ev({ type: "down", x: 20, raw: down }))
        target.push(ev({ type: "leave", x: 20, raw: { name: "leave" } }))
        global.push(ev({ type: "down", x: 300, raw: { name: "down again" } }), {})
        yield* settle
        expect(seen.slice(6).map((event) => `${event.type} ${(event.raw as { readonly name: string }).name}`)).toEqual(["down down", "leave leave", "move down"])
        yield* Fiber.interrupt(fiber)
      }))
  })

  describe("C12: without global, and at the stream's end", () => {
    it.effect("C12: with no global, events pass through unchanged and interrupting unsubscribes target", () =>
      Effect.gen(function* () {
        const target = makeFeed()
        const { seen, fiber } = yield* start(target)
        const down = ev({ type: "down", x: 1 })
        const move = ev({ type: "move", x: 2 })
        const up = ev({ type: "up", x: 3, pressed: false })
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

  describe("C25-C28: delivery inside the platform's dispatch (ADR-0032)", () => {
    // The stream runs on a browser's scheduler: `setTimeout(0)` dispatch, what Effect picks with
    // no `setImmediate`. A delivery through it would land after `push` returns (#32's hop 1);
    // every expectation below is read synchronously, right after the push.

    /** Run the stream on a `setTimeout(0)` scheduler; `onEvent` runs inside each delivery. */
    const startOnTimers = async (
      target: Feed,
      global?: Feed,
      scroll?: ScrollFeedFake,
      onEvent: (event: InputSource.PointerLikeEvent) => void = () => {},
    ) => {
      const scheduler = new MixedScheduler("async", (task) => {
        const timer = setTimeout(task, 0)
        return () => clearTimeout(timer)
      })
      const seen: Array<string> = []
      const fiber = Effect.runFork(
        Stream.runForEach(InputFeed.toStream(InputSource.heldPointer({ target: target.feed, global: global?.feed, scroll: scroll?.feed })), (event) =>
          Effect.sync(() => {
            seen.push(key(event))
            onEvent(event)
          })),
        { scheduler },
      )
      // `Stream.callback` registers the feeds in a task of its own; the consumer waits from then.
      while (!target.subscribed()) await new Promise((resolve) => setTimeout(resolve, 0))
      return { seen, stop: () => Effect.runPromise(Fiber.interrupt(fiber), { scheduler }) }
    }

    it("C25: a target event reaches a waiting consumer inside its emit", async () => {
      const target = makeFeed()
      const h = await startOnTimers(target)
      target.push(ev({ type: "move", x: 1, pressed: false }))
      expect(h.seen).toEqual(["move1@1"])
      target.push(ev({ type: "down", x: 2 }))
      target.push(ev({ type: "move", x: 3 }))
      target.push(ev({ type: "up", x: 4 }))
      expect(h.seen).toEqual(["move1@1", "down1@2", "move1@3", "up1@4"])
      await h.stop()
    })

    it("C26: a held pointer's page-wide events, a page-wide down's lost release and a scroll's move arrive inside their emits", async () => {
      const target = makeFeed()
      const global = makeFeed()
      const page = {}
      const scroll = makeScrollFeed([[page, { x: 0, y: 0 }]])
      const h = await startOnTimers(target, global, scroll)
      target.push(ev({ type: "down", x: 0 }))
      global.push(ev({ type: "move", x: 10 }))
      expect(h.seen).toEqual(["down1@0", "move1@10"])
      scroll.scrollTo(page, 0, 5, 20)
      expect(h.seen).toEqual(["down1@0", "move1@10", "move1@10"])
      // The page-wide down of the same pointer ends the hold with an unpressed move (decision 7).
      global.push(ev({ type: "down", x: 50 }))
      expect(h.seen).toEqual(["down1@0", "move1@10", "move1@10", "move1@10"])
      await h.stop()
    })

    it("C27: the consumer handles an event after the hold has taken it: global subscribed at the down, released at the up", async () => {
      const target = makeFeed()
      const global = makeFeed()
      const atDelivery: Array<string> = []
      const h = await startOnTimers(target, global, undefined, (event) => {
        atDelivery.push(`${event.type}: global ${Bool.match(global.subscribed(), { onTrue: () => "on", onFalse: () => "off" })}`)
      })
      target.push(ev({ type: "down" }))
      global.push(ev({ type: "up", pressed: false }))
      expect(atDelivery).toEqual(["down: global on", "up: global off"])
      await h.stop()
    })

    it("C28: an event emitted while the consumer handles one is delivered after it, in order, still inside the first emit", async () => {
      const target = makeFeed()
      let nested = true
      const h = await startOnTimers(target, undefined, undefined, (event) => {
        if (nested && event.x === 1) {
          nested = false
          target.push(ev({ type: "move", x: 2, pressed: false }))
          // Not yet: the consumer is still handling the first.
          expect(h.seen).toEqual(["move1@1"])
        }
      })
      target.push(ev({ type: "move", x: 1, pressed: false }))
      expect(h.seen).toEqual(["move1@1", "move1@2"])
      await h.stop()
    })
  })
})
