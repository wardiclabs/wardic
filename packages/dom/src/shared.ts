/**
 * Shared-source helpers — the @wardic/dom realization of CONTEXT.md's
 * **Shared source** contract: every Stream an Environment hands out is hot and
 * ref-counted per target. Subscribers share one underlying source (one rAF
 * loop, one listener-set per element, one observer), established on first
 * subscribe and torn down when the last unsubscribes. A consumer attaching
 * `hover` + `press` + `drag` to one element must get one listener-set, not
 * three (see ADR-0006 — unmount drops the ref-count).
 *
 * Two helpers, both built on the same primitive — a `PubSub` fed by a
 * `forkScoped` pump that drains the cold source — wrapped in Effect's
 * reference-counted resource caches:
 *
 * - {@link makeSharedByTarget} keys on the target (`RcMap`): one entry per
 *   distinct target, the cold `lookup` runs once per target while ≥1 subscriber
 *   holds it. The main path for `InputSource.pointer`/`keyboard`/`wheel`/`focus`
 *   and `Probe.observeResize`/`observeIntersection`.
 * - {@link makeSharedGlobal} is the keyless single-instance case (`RcRef`): one
 *   shared resource for the whole Environment — the global rAF loop
 *   (`Clock.ticks`) or a document-level keyboard.
 *
 * In both cases the returned function yields a HOT multicast Stream. The cold
 * source is acquired on the first subscriber and released when the last
 * subscriber's scope closes — `Stream.unwrap` holds the Rc{Map,Ref} reference
 * for the subscriber stream's lifetime, so when the last subscriber ends the
 * cache releases the entry, the `forkScoped` pump interrupts, and the cold
 * source (e.g. `fromEventListener`) runs its finalizers (remove the listener).
 *
 * Observability (CONTEXT.md observability convention): each helper emits a
 * `wardic.*` span + a debug-log on subscribe; the per-event publish path stays
 * quiet (hot path).
 */
import type { Duration } from "effect"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as PubSub from "effect/PubSub"
import * as RcMap from "effect/RcMap"
import * as RcRef from "effect/RcRef"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

/** Options shared by both helpers. */
export interface SharedOptions {
  /**
   * Debounce teardown of an idle (zero-reference) resource by this duration:
   * the cold source is kept alive for this long after the last subscriber
   * leaves, so a rapid re-subscribe reuses it instead of re-acquiring. Maps
   * straight onto Rc{Map,Ref}'s `idleTimeToLive`. Default: none (teardown is
   * immediate on the last unsubscribe).
   */
  readonly idleTimeToLive?: Duration.Input | undefined
}

/**
 * Builds the hot `PubSub` that fronts a cold source: acquire the source via
 * `acquire`, fork a scoped pump that republishes every element into the PubSub,
 * and hand back the PubSub. The pump is bound to the Rc cache entry's scope, so
 * when the cache releases the entry the pump is interrupted and the cold
 * source's finalizers run. Per-element publishing is deliberately un-logged —
 * it is the hot path.
 */
const fanIn = <A>(
  acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
): Effect.Effect<PubSub.PubSub<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<A>()
    const source = yield* acquire
    yield* Effect.forkScoped(Stream.runForEach(source, (a) => PubSub.publish(pubsub, a)))
    return pubsub
  })

/**
 * Identity key wrapper for `RcMap`. `RcMap` hashes its keys with Effect's
 * structural `Hash`, which **throws** on a DOM element (it recurses into the
 * element's function properties and touches `.caller` in strict mode) and would
 * conflate two structurally-equal-but-distinct targets. We instead key by this
 * wrapper: equality is by reference (`this === that`) and the hash is a stable
 * per-instance counter — so RcMap never structurally inspects the target, and
 * each distinct target is its own entry. One wrapper is cached per target (see
 * the `WeakMap` in {@link makeSharedByTarget}).
 */
let nextTargetHash = 1
class TargetKey implements Equal.Equal {
  readonly hash: number
  constructor(readonly target: unknown) {
    this.hash = nextTargetHash++
  }
  [Hash.symbol](): number {
    return this.hash
  }
  [Equal.symbol](that: Equal.Equal): boolean {
    return this === that
  }
}

/**
 * Per-target shared source. Returns a function `(target) => Stream<A>` whose
 * Stream is hot and ref-counted per `target`: the first subscriber for a given
 * target acquires the cold source via `lookup(target)`; concurrent subscribers
 * to the same target share that one source; the source is released when the
 * last subscriber for that target unsubscribes (optionally after
 * `idleTimeToLive`).
 *
 * @example
 * const pointer = yield* makeSharedByTarget((el) => fromEventListener(el, "pointermove"))
 * // both share one listener-set on `el`:
 * Stream.runForEach(pointer(el), onHover)
 * Stream.runForEach(pointer(el), onPress)
 */
export const makeSharedByTarget = <A>(
  lookup: (target: unknown) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
  options?: SharedOptions,
): Effect.Effect<(target: unknown) => Stream.Stream<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.logDebug("wardic.dom.shared.byTarget: create")
    // One stable identity key per target (see TargetKey). Object targets are
    // cached weakly so the key — and the RcMap entry it addresses — share the
    // target's lifetime; non-object targets (rare) hash safely on their own.
    const keys = new WeakMap<object, TargetKey>()
    const keyFor = (target: unknown): unknown => {
      if (typeof target !== "object" || target === null) return target
      let key = keys.get(target)
      if (key === undefined) {
        key = new TargetKey(target)
        keys.set(target, key)
      }
      return key
    }
    const map = yield* RcMap.make({
      lookup: (key: unknown) => fanIn(lookup(key instanceof TargetKey ? key.target : key)),
      ...(options?.idleTimeToLive !== undefined ? { idleTimeToLive: options.idleTimeToLive } : {}),
    })
    return (target: unknown): Stream.Stream<A> =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* Effect.logDebug("wardic.dom.shared.byTarget: subscribe")
          const pubsub = yield* RcMap.get(map, keyFor(target))
          return Stream.fromPubSub(pubsub)
        }),
      ).pipe(Stream.withSpan("wardic.dom.shared.byTarget"))
  })

/**
 * Global (keyless) shared source. Returns a single hot, ref-counted Stream<A>:
 * the first subscriber acquires the cold source via `acquire`; concurrent
 * subscribers share it; it is released when the last subscriber unsubscribes
 * (optionally after `idleTimeToLive`). The single-instance counterpart of
 * {@link makeSharedByTarget} — for the global rAF loop or a document keyboard.
 *
 * @example
 * const ticks = yield* makeSharedGlobal(rafTickStream)
 * Stream.runForEach(ticks, step) // one rAF loop, shared by every primitive
 */
export const makeSharedGlobal = <A>(
  acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
  options?: SharedOptions,
): Effect.Effect<Stream.Stream<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.logDebug("wardic.dom.shared.global: create")
    const ref = yield* RcRef.make({
      acquire: fanIn(acquire),
      ...(options?.idleTimeToLive !== undefined ? { idleTimeToLive: options.idleTimeToLive } : {}),
    })
    return Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.logDebug("wardic.dom.shared.global: subscribe")
        const pubsub = yield* RcRef.get(ref)
        return Stream.fromPubSub(pubsub)
      }),
    ).pipe(Stream.withSpan("wardic.dom.shared.global"))
  })
