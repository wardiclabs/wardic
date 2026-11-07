// Core's SharedSource (#37, ADR-0041 *Amendment (#37)*): a cold source shared, hot and ref-counted,
// per target (`byTarget`) or for the whole Environment (`make`), on one counted map of its own (`counted`,
// #518). CONTEXT.md's **Shared source** contract.
//
// - SS1: two subscribers to one target share one lookup and its events.
// - SS2: a target Effect's structural `Hash` would throw on (a throwing getter here; a DOM node in
//   a browser, pinned in dom's shared-source.browser.test.ts) is keyed by identity: the lookup runs.
// - SS3: distinct targets get distinct lookups, each with its own events.
// - SS4: closing one subscriber keeps the source until the last closes, then releases it once.
// - SS5: re-subscribing after teardown looks up afresh.
// - SS7: `make`'s subscribers share one acquire and the same events, released with the last.
// - SS8: `make` re-acquires after the last unsubscribe.
// - SS9: a source that ends ends every subscriber, on each constructor (#618, decision 6).
// - SS10: a source that dies fails every subscriber with its defect, on each constructor (#618).
// - SS11: `counted` opens a key's value once for every hold, closes it with the last release, and opens
//   it afresh after; a key is held by identity (#518).
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SharedSource from "../src/SharedSource.ts"

/**
 * A test-controlled cold source factory that records ref-counting facts. Each
 * `lookup(target)`/`acquire` increments `acquired`; the returned source is fed
 * by a per-call `PubSub` (so the test drives emissions on its own schedule) and
 * registers a scoped finalizer bumping `released` — proving the cold source is
 * torn down when the cache releases the entry (not by mocking the outcome).
 */
const makeProbeSource = <A>() =>
  Effect.gen(function* () {
    const acquired = yield* Ref.make(0)
    const released = yield* Ref.make(0)
    // One PubSub per distinct acquire so a test can address each target.
    const pubsubs = yield* Ref.make<ReadonlyArray<PubSub.PubSub<A>>>([])

    const acquire = Effect.gen(function* () {
      yield* Ref.update(acquired, (n) => n + 1)
      yield* Effect.addFinalizer(() => Ref.update(released, (n) => n + 1))
      const pubsub = yield* PubSub.unbounded<A>()
      yield* Ref.update(pubsubs, (xs) => [...xs, pubsub])
      return Stream.fromPubSub(pubsub)
    })

    const publish = (index: number, value: A) =>
      Effect.gen(function* () {
        const all = yield* Ref.get(pubsubs)
        const target = all[index]
        if (target !== undefined) {
          yield* PubSub.publish(target, value)
        }
        // Hand the scheduler a small budget so subscribers drain before the
        // test asserts (mirrors @wardic/test's pushable drain pattern).
        yield* Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })
      })

    return {
      acquire,
      lookup: (_target: unknown) => acquire,
      getAcquired: Ref.get(acquired),
      getReleased: Ref.get(released),
      publish,
    }
  })

/**
 * Subscribe to a shared Stream in its own fiber; collect events into a Ref.
 * `Stream.runForEach`'s internal scope is the fiber's scope, so interrupting the
 * fiber closes the subscriber's scope — which is exactly what drops the
 * ref-count on the shared source. `close` interrupts and awaits the fiber so the
 * underlying scope's finalizers have run before the test asserts.
 */
const subscribeIn = <A>(stream: Stream.Stream<A>) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<A>>([])
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(stream, (a) => Ref.update(received, (xs) => [...xs, a])),
    )
    // Let the subscription become live before the test publishes.
    yield* Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })
    return {
      received: Ref.get(received),
      close: Fiber.interrupt(fiber).pipe(
        Effect.andThen(Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })),
      ),
    }
  })

describe("SharedSource.byTarget", () => {
  it.effect("SS1: two concurrent subscribers to the same target share one lookup", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.byTarget(probe.lookup)
      const target = { id: "a" }
      const a = yield* subscribeIn(shared(target))
      const b = yield* subscribeIn(shared(target))

      // Lookup ran exactly once for the shared target.
      expect(yield* probe.getAcquired).toBe(1)

      // Both subscribers receive the same published events.
      yield* probe.publish(0, 10)
      yield* probe.publish(0, 20)

      expect(yield* a.received).toEqual([10, 20])
      expect(yield* b.received).toEqual([10, 20])

      yield* a.close
      yield* b.close
    }))

  // A key Effect's structural Hash throws on, as it does on a DOM node: RcMap would hash it and the
  // throw would kill the subscriber, so the lookup would never run. TargetKey keys it by identity.
  it.effect("SS2: a target structural hashing would throw on is keyed by identity: the lookup runs", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.byTarget(probe.lookup)
      const hostile = {
        get boom(): never {
          throw new Error("a structural hash read this")
        },
      }
      const a = yield* subscribeIn(shared(hostile))
      expect(yield* probe.getAcquired).toBe(1)
      yield* probe.publish(0, 7)
      expect(yield* a.received).toEqual([7])
      yield* a.close
    }))

  it.effect("SS3: distinct targets get distinct lookups", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.byTarget(probe.lookup)
      const a = yield* subscribeIn(shared({ id: "a" }))
      const b = yield* subscribeIn(shared({ id: "b" }))

      // Two distinct targets => two separate lookups.
      expect(yield* probe.getAcquired).toBe(2)

      // Each subscriber only sees its own target's events.
      yield* probe.publish(0, 1)
      yield* probe.publish(1, 2)

      expect(yield* a.received).toEqual([1])
      expect(yield* b.received).toEqual([2])

      yield* a.close
      yield* b.close
    }))

  it.effect("SS4: closing one subscriber keeps the source until the last closes", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.byTarget(probe.lookup)
      const target = { id: "a" }
      const a = yield* subscribeIn(shared(target))
      const b = yield* subscribeIn(shared(target))

      expect(yield* probe.getAcquired).toBe(1)
      expect(yield* probe.getReleased).toBe(0)

      // First subscriber leaves: ref-count still ≥1, source stays.
      yield* a.close
      expect(yield* probe.getReleased).toBe(0)

      // b still receives events from the live source.
      yield* probe.publish(0, 99)
      expect(yield* b.received).toEqual([99])

      // Last subscriber leaves: source is released exactly once.
      yield* b.close
      expect(yield* probe.getReleased).toBe(1)
    }))

  it.effect("SS5: re-subscribing after teardown performs a fresh lookup", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.byTarget(probe.lookup)
      const target = { id: "a" }
      const a = yield* subscribeIn(shared(target))
      expect(yield* probe.getAcquired).toBe(1)
      yield* a.close
      expect(yield* probe.getReleased).toBe(1)

      // Fresh subscribe after the entry was released re-acquires.
      const b = yield* subscribeIn(shared(target))
      expect(yield* probe.getAcquired).toBe(2)
      yield* b.close
      expect(yield* probe.getReleased).toBe(2)
    }))
})

describe("SharedSource.make", () => {
  it.effect("SS7: concurrent subscribers share one acquire and the same events", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.make(probe.acquire)
      const a = yield* subscribeIn(shared)
      const b = yield* subscribeIn(shared)

      // Single shared resource: acquired once for all subscribers.
      expect(yield* probe.getAcquired).toBe(1)

      yield* probe.publish(0, 7)
      expect(yield* a.received).toEqual([7])
      expect(yield* b.received).toEqual([7])

      yield* a.close
      expect(yield* probe.getReleased).toBe(0)
      yield* b.close
      expect(yield* probe.getReleased).toBe(1)
    }))

  it.effect("SS8: re-subscribing after the last unsubscribe re-acquires", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.make(probe.acquire)
      const a = yield* subscribeIn(shared)
      expect(yield* probe.getAcquired).toBe(1)
      yield* a.close
      expect(yield* probe.getReleased).toBe(1)

      const b = yield* subscribeIn(shared)
      expect(yield* probe.getAcquired).toBe(2)
      yield* b.close
      expect(yield* probe.getReleased).toBe(2)
    }))
})

describe("a shared source's end and failure reach its subscribers (#618)", () => {
  /** Each of two subscribers' `Exit`, joined, for a source that `acquire` gives. */
  const exitsOf = (shared: Stream.Stream<number>) =>
    Effect.gen(function* () {
      const a = yield* Effect.forkChild(Stream.runCollect(shared))
      const b = yield* Effect.forkChild(Stream.runCollect(shared))
      return [yield* Fiber.await(a), yield* Fiber.await(b)] as const
    })
  const ending = Effect.succeed(Stream.fromIterable([1, 2]))
  const dying = Effect.succeed(Stream.concat(Stream.make(1), Stream.die(new Error("source broke"))))

  it.effect("SS9: a source that ends ends every subscriber, by target and for the whole Environment", () =>
    Effect.gen(function* () {
      const byTarget = yield* SharedSource.byTarget(() => ending)
      const made = yield* SharedSource.make(ending)
      for (const shared of [byTarget("card"), made]) {
        const exits = yield* exitsOf(shared)
        for (const exit of exits) expect(Exit.isSuccess(exit), "ended, not hung").toBe(true)
      }
    }))

  it.effect("SS10: a source that dies fails every subscriber with its defect", () =>
    Effect.gen(function* () {
      const byTarget = yield* SharedSource.byTarget(() => dying)
      const made = yield* SharedSource.make(dying)
      for (const shared of [byTarget("card"), made]) {
        const exits = yield* exitsOf(shared)
        for (const exit of exits) {
          expect(Exit.isFailure(exit), "failed, not silently stopped").toBe(true)
          expect(String(Exit.isFailure(exit) && Cause.squash(exit.cause))).toContain("source broke")
        }
      }
    }))
})

describe("SharedSource.counted (#518)", () => {
  it.effect("SS11: a key's value opens once for every hold, closes with the last release, and opens afresh after", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const hold = SharedSource.counted(
        (key: object) => {
          events.push("open")
          return { key }
        },
        () => Effect.sync(() => void events.push("close")),
      )
      // Two equal-looking targets are two keys: held by identity, never hashed.
      const card = { id: "card" }
      const twin = { id: "card" }
      const first = Scope.makeUnsafe()
      const second = Scope.makeUnsafe()
      const a = yield* Scope.provide(hold(card), first)
      const b = yield* Scope.provide(hold(card), second)
      expect(a).toBe(b)
      expect(events).toEqual(["open"])
      const other = yield* Effect.scoped(hold(twin))
      expect(other).not.toBe(a)
      expect(events).toEqual(["open", "open", "close"])
      yield* Scope.close(first, Exit.void)
      expect(events).toEqual(["open", "open", "close"])
      yield* Scope.close(second, Exit.void)
      expect(events).toEqual(["open", "open", "close", "close"])
      const again = yield* Effect.scoped(hold(card))
      expect(again).not.toBe(a)
      expect(events).toEqual(["open", "open", "close", "close", "open", "close"])
    }))
})
