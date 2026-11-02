/**
 * The `SharedSource` module: how an Environment meets CONTEXT.md's **Shared source** contract
 * for the Streams it hands out (#37, ADR-0041 *Amendment (#37)*): each is hot and ref-counted, its
 * subscribers sharing one underlying source (one observer per target, one page-wide feed),
 * established on first subscribe and torn down when the last unsubscribes. An Environment's
 * **Input feeds** are shared by `InputFeed.byTarget` instead, with no `PubSub` or fiber (#318).
 *
 * Two constructors, both built on the same primitive (a `PubSub` fed by a `forkScoped` pump that
 * drains the cold source), wrapped in Effect's reference-counted resource caches:
 *
 * - {@link byTarget} keys on the target (`RcMap`): one entry per distinct target, the cold `lookup`
 *   running once per target while a subscriber holds it. An Environment's `Probe.observeResize`.
 * - {@link make} is the keyless case (`RcRef`): one shared source for the whole Environment, a
 *   page-wide feed.
 *
 * Either way the result is a hot multicast Stream. The cold source is acquired by the first
 * subscriber and released when the last subscriber's scope closes: `Stream.unwrap` holds the Rc
 * reference for the subscriber stream's lifetime, so when the last one ends the cache releases the
 * entry, the pump is interrupted, and the cold source's finalizers run (a listener is removed).
 *
 * Tier 2 (ADR-0008), for Environment authors, as `InputSource.heldPointer` is (#31's rule: Wardic
 * ships what makes a new Environment little work). The DOM's Environment builds its sources with it.
 *
 * Observability: each constructor emits a `wardic.sharedSource.*` span and a debug log on
 * subscribe; the per-event publish path stays quiet (the hot path).
 */
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { identity } from "effect/Function"
import * as Hash from "effect/Hash"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as PubSub from "effect/PubSub"
import * as RcMap from "effect/RcMap"
import * as RcRef from "effect/RcRef"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { tracedStream } from "./internal/tracing.ts"

/** Options for both constructors. */
export interface Options {
  /**
   * Debounce teardown of an idle (zero-reference) source by this duration: the cold source is
   * kept alive for this long after the last subscriber leaves, so a rapid re-subscribe reuses it
   * instead of re-acquiring. Maps straight onto Rc{Map,Ref}'s `idleTimeToLive`. Default: none
   * (teardown is immediate on the last unsubscribe).
   */
  readonly idleTimeToLive?: Duration.Input | undefined
}

/**
 * The hot `PubSub` that fronts a cold source: acquire the source via `acquire`, fork a scoped pump
 * that republishes every element into the PubSub, and hand back the PubSub. The pump is bound to
 * the Rc cache entry's scope, so when the cache releases the entry the pump is interrupted and the
 * cold source's finalizers run. Per-element publishing is un-logged: it's the hot path.
 */
const fanIn: <A>(
  acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
) => Effect.Effect<PubSub.PubSub<A>, never, Scope.Scope> = /*#__PURE__*/ Effect.fnUntraced(
  function* <A>(acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>) {
    const pubsub = yield* PubSub.unbounded<A>()
    const source = yield* acquire
    yield* Effect.forkScoped(Stream.runForEach(source, (a) => PubSub.publish(pubsub, a)))
    return pubsub
  })

/**
 * An identity key for `RcMap`. `RcMap` hashes its keys with Effect's structural `Hash`, which
 * walks a target's properties: on a platform object that can throw (a DOM node's function
 * properties touch `.caller` in strict mode), and it would conflate two structurally equal but
 * distinct targets. This wrapper is equal by reference, with a stable per-instance hash, so `RcMap`
 * never inspects the target and each distinct target is its own entry. One wrapper is cached per
 * target (the `WeakMap` in {@link byTarget}).
 */
// Module state (#460, Q7): an id counter, only ever compared for distinctness, so every runtime may share it.
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

/** The target a key addresses: a {@link TargetKey}'s own, else the key itself (a non-object target). */
const targetOf: (key: unknown) => unknown = /*#__PURE__*/ Match.type<unknown>().pipe(
  Match.when(Match.instanceOf(TargetKey), (key) => key.target),
  Match.orElse(identity),
)

/** The cache's `idleTimeToLive`, when the options give one. */
const idleOf = (options: Options = {}): { readonly idleTimeToLive?: Duration.Input } =>
  UndefinedOr.match(options.idleTimeToLive, { onUndefined: () => ({}), onDefined: (idleTimeToLive) => ({ idleTimeToLive }) })

/**
 * A Shared source per target: a function `(target) => Stream<A>` whose Stream is hot and
 * ref-counted per `target`. The first subscriber for a target acquires the cold source via
 * `lookup(target)`; concurrent subscribers to that target share it; it's released when the last
 * subscriber for that target unsubscribes (after `idleTimeToLive`, if given).
 *
 * @example
 * // `resizesOf(target)`: an Environment's cold Stream of a target's sizes
 * const resize = yield* SharedSource.byTarget((target) => Effect.succeed(resizesOf(target)))
 * // both share one observer on `target`:
 * Stream.runForEach(resize(target), onLayout)
 * Stream.runForEach(resize(target), onScroll)
 */
export const byTarget: <A>(
  lookup: (target: unknown) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
  options?: Options,
) => Effect.Effect<(target: unknown) => Stream.Stream<A>, never, Scope.Scope> = /*#__PURE__*/ Effect.fnUntraced(
  function* <A>(lookup: (target: unknown) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope>, options?: Options) {
    yield* Effect.logDebug("wardic.sharedSource.byTarget: create")
    // One stable identity key per target (see TargetKey). Object targets are cached weakly, so the
    // key, and the RcMap entry it addresses, share the target's lifetime; a non-object target hashes
    // safely on its own.
    const keys = new WeakMap<object, TargetKey>()
    const keyFor = (target: unknown): unknown =>
      Option.match(Option.liftPredicate(target, Predicate.isObjectOrArray), {
        onNone: () => target,
        onSome: (object) =>
          Option.getOrElse(Option.fromUndefinedOr(keys.get(object)), () => {
            const key = new TargetKey(object)
            keys.set(object, key)
            return key
          }),
      })
    const map = yield* RcMap.make({
      lookup: (key: unknown) => fanIn(lookup(targetOf(key))),
      ...idleOf(options),
    })
    return (target: unknown): Stream.Stream<A> =>
      tracedStream(
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.logDebug("wardic.sharedSource.byTarget: subscribe")
            const pubsub = yield* RcMap.get(map, keyFor(target))
            return Stream.fromPubSub(pubsub)
          }),
        ),
        "wardic.sharedSource.byTarget",
      )
  })

/**
 * One Shared source for the whole Environment: a single hot, ref-counted Stream<A>. The first
 * subscriber acquires the cold source via `acquire`; concurrent subscribers share it; it's released
 * when the last unsubscribes (after `idleTimeToLive`, if given). The keyless counterpart of
 * {@link byTarget}, as `RcRef.make` is `RcMap.make`'s: for a page-wide feed.
 *
 * @example
 * // `viewportChanges`: an Environment's cold Stream of its viewport's size
 * const viewport = yield* SharedSource.make(Effect.succeed(viewportChanges))
 * Stream.runForEach(viewport, onResize) // one listener, however many subscribe
 */
export const make: <A>(
  acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
  options?: Options,
) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope> = /*#__PURE__*/ Effect.fnUntraced(
  function* <A>(acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>, options?: Options) {
    yield* Effect.logDebug("wardic.sharedSource.make: create")
    const ref = yield* RcRef.make({
      acquire: fanIn(acquire),
      ...idleOf(options),
    })
    return tracedStream(
      Stream.unwrap(
        Effect.gen(function* () {
          yield* Effect.logDebug("wardic.sharedSource.make: subscribe")
          const pubsub = yield* RcRef.get(ref)
          return Stream.fromPubSub(pubsub)
        }),
      ),
      "wardic.sharedSource.make",
    )
  })
