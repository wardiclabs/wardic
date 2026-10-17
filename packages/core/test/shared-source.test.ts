// Core's SharedSource (#37, ADR-0041 *Amendment (#37)*): a cold source shared, hot and ref-counted,
// per target (`byTarget`, `RcMap`) or for the whole Environment (`make`, `RcRef`). CONTEXT.md's
// **Shared source** contract.
//
// - SS1: two subscribers to one target share one lookup and its events.
// - SS2: a target Effect's structural `Hash` would throw on (a throwing getter here; a DOM node in
//   a browser, pinned in dom's shared-source.browser.test.ts) is keyed by identity: the lookup runs.
// - SS3: distinct targets get distinct lookups, each with its own events.
// - SS4: closing one subscriber keeps the source until the last closes, then releases it once.
// - SS5: re-subscribing after teardown looks up afresh.
// - SS6: `idleTimeToLive` keeps an idle source for a rapid re-subscribe, then releases it.
// - SS7: `make`'s subscribers share one acquire and the same events, released with the last.
// - SS8: `make` re-acquires after the last unsubscribe.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
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

  // Deterministic virtual time: idleTimeToLive is a real-duration debounce, but
  // RcMap implements it via the Effect `Clock` (clock.sleep), so `TestClock`
  // drives it exactly — no wall-clock flake. A
  // re-subscribe within the TTL reuses the still-idle source (no re-acquire);
  // a re-subscribe after the TTL has elapsed re-acquires.
  it.effect("SS6: idleTimeToLive debounces teardown on rapid re-subscribe", () =>
    Effect.gen(function* () {
      const probe = yield* makeProbeSource<number>()
      const shared = yield* SharedSource.byTarget(probe.lookup, { idleTimeToLive: "200 millis" })
      const target = { id: "a" }

      const a = yield* subscribeIn(shared(target))
      expect(yield* probe.getAcquired).toBe(1)
      yield* a.close
      // Idle, but within the TTL window: not yet released.
      expect(yield* probe.getReleased).toBe(0)

      // Rapid re-subscribe reuses the debounced entry — no fresh lookup.
      const b = yield* subscribeIn(shared(target))
      expect(yield* probe.getAcquired).toBe(1)
      expect(yield* probe.getReleased).toBe(0)
      yield* b.close

      // Now let the TTL elapse with no subscribers: the source is released.
      yield* TestClock.adjust("400 millis")
      expect(yield* probe.getReleased).toBe(1)

      // A subscribe after teardown performs a fresh lookup.
      const c = yield* subscribeIn(shared(target))
      expect(yield* probe.getAcquired).toBe(2)
      yield* c.close
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
