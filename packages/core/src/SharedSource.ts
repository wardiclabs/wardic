/**
 * Shared sources, for the Streams an Environment hands out: each hot and counted, so however many
 * subscribe, one underlying source runs, started by the first subscriber and stopped when the last one
 * leaves. `byTarget` keeps one per target, one observer on each element, and `make` one for the whole
 * Environment. An Environment builds its sources with these, as `@wardic/dom` does, and `counted` shares
 * anything else it opens per target.
 *
 * @example
 * import * as SharedSource from "@wardic/core/SharedSource"
 *
 * const resize = yield* SharedSource.byTarget((target) => Effect.succeed(resizesOf(target)))
 * // Both share one observer on `card`:
 * Stream.runForEach(resize(card), onLayout)
 * Stream.runForEach(resize(card), onScroll)
 */
// CONTEXT.md's **Shared source** contract (#37, ADR-0041 *Amendment (#37)*). An Environment's **Input
// feeds** are shared by `InputFeed.byTarget` instead, with no fiber (#318).
//
// One shape under both constructors (#518, ADR-0067 *Amendment (#518)*, decision 3): a target's entry in
// a `counted` map holds its subscribers' hearings and, while any subscriber holds it, a pump that runs the
// cold source and hands each element to every hearing, which resumes a waiting subscriber inside the
// call, as the `PubSub` did. The first subscriber opens the entry and starts the pump; the
// last one's release interrupts it, and the cold source's finalizers run (a listener is removed). The
// source's end ends every subscriber, and its failure fails them (#618, decision 6). It replaced a
// `PubSub` per source in Effect's `RcMap` and `RcRef`, whose code every app shipped (4.1 KB gzipped with
// `Clock.ticks`' and the DOM's scroll containers'), and whose `idleTimeToLive` nothing passed.
//
// Tier 2 (ADR-0008), for Environment authors, as `InputSource.heldPointer` is (#31's rule: Wardic ships
// what makes a new Environment little work). Observability: each constructor emits a
// `wardic.sharedSource.*` span and a debug log on subscribe; the per-event path stays quiet.
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Iter from "effect/Iterable"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Hearing from "./internal/hearing.ts"
import { tracedStream } from "./internal/tracing.ts"

/** A key's value in a `counted` map, and how many hold it. */
interface Held<V> {
  readonly value: V
  count: number
}

/**
 * Values shared by key and counted: the first hold of a key opens its value with `open`, later holds
 * share it, and the last one's release closes it with `close`. A key is held by identity and never
 * hashed, so a DOM node is its own key. `open` runs inline, so it mustn't wait.
 *
 * @example
 * // One listener set per container, however many readers hold it
 * const containers = SharedSource.counted(
 *   (container: Element) => ({ remove: listenTo(container) }),
 *   (listening) => Effect.sync(listening.remove),
 * )
 * const listening = yield* containers(list) // held until the current Scope closes
 */
// #518: what `RcMap` gave the DOM's scroll containers (#618, M7), with no Scope per entry and no `Hash`.
export const counted = <K, V>(
  open: (key: K) => V,
  close: (value: V) => Effect.Effect<void>,
): ((key: K) => Effect.Effect<V, never, Scope.Scope>) => {
  const held = new Map<K, Held<V>>()
  const acquire = (key: K): Effect.Effect<Held<V>> =>
    Effect.sync(() => {
      const entry = Option.getOrElse(Option.fromUndefinedOr(held.get(key)), () => {
        const opened: Held<V> = { value: open(key), count: 0 }
        held.set(key, opened)
        return opened
      })
      entry.count++
      return entry
    })
  const release = (key: K, entry: Held<V>): Effect.Effect<void> =>
    Effect.suspend(() => {
      entry.count--
      if (entry.count > 0) return Effect.void
      if (held.get(key) === entry) held.delete(key)
      return close(entry.value)
    })
  return (key) => Effect.map(Effect.acquireRelease(acquire(key), (entry) => release(key, entry)), (entry) => entry.value)
}

/** A source shared by its subscribers: their hearings, its pump while it runs, and how it ended, once it has. */
interface Fanned<A> {
  readonly hearings: Set<Hearing.Hearing<A>>
  pump: Option.Option<Fiber.Fiber<void>>
  ended: Option.Option<Exit.Exit<void>>
}

/** A fresh source's entry, with no subscriber, no pump and no end. */
const fanned = <A>(): Fanned<A> => ({ hearings: new Set(), pump: Option.none(), ended: Option.none() })

/** The pump: `acquire`'s source, each element to every subscriber; its end, kept and handed to each. */
const pumpOf = <A>(entry: Fanned<A>, acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>): Effect.Effect<void> =>
  Effect.scoped(
    Effect.flatMap(acquire, (source) => Stream.runForEach(source, (a) => Effect.sync(() => Iter.forEach(entry.hearings, (hearing) => hearing.hear(a))))),
  ).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        entry.ended = Option.some(exit)
        Iter.forEach(entry.hearings, (hearing) => hearing.end(exit))
      })
    ),
  )

/** An entry's pump stopped, its last subscriber gone. */
const stop = <A>(entry: Fanned<A>): Effect.Effect<void> =>
  Option.match(entry.pump, { onNone: () => Effect.void, onSome: (pump) => Effect.asVoid(Fiber.interrupt(pump)) })

/**
 * A subscriber to `key`'s shared source: its hearing on the entry while its Stream runs, the pump started
 * for the first, in `scope`, the shared source's. One that subscribes after the source ended gets the end
 * alone.
 */
const subscriberOf = <A>(
  hold: (key: unknown) => Effect.Effect<Fanned<A>, never, Scope.Scope>,
  key: unknown,
  acquire: () => Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
  scope: Scope.Scope,
): Stream.Stream<A> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const entry = yield* hold(key)
      const hearing = Hearing.make<A>()
      if (Option.isSome(entry.ended)) {
        hearing.end(entry.ended.value)
        return hearing.stream
      }
      // Its hearing first, so what the pump hands on as it starts reaches it.
      entry.hearings.add(hearing)
      yield* Effect.addFinalizer(() => Effect.sync(() => entry.hearings.delete(hearing)))
      if (Option.isNone(entry.pump)) entry.pump = Option.some(yield* Effect.forkIn(pumpOf(entry, acquire()), scope, { startImmediately: true }))
      return hearing.stream
    }),
  )

/**
 * A shared source per target: a function from a target to a Stream that's hot and counted for that
 * target. The first subscriber for a target starts `lookup(target)`'s source, later ones share it, and it
 * stops when the last one for that target leaves.
 *
 * @example
 * // `resizesOf(target)`: an Environment's own Stream of a target's sizes
 * const resize = yield* SharedSource.byTarget((target) => Effect.succeed(resizesOf(target)))
 */
export const byTarget: <A>(
  lookup: (target: unknown) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
) => Effect.Effect<(target: unknown) => Stream.Stream<A>, never, Scope.Scope> = /*#__PURE__*/ Effect.fnUntraced(
  function* <A>(lookup: (target: unknown) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope>) {
    yield* Effect.logDebug("wardic.sharedSource.byTarget: create")
    const scope = yield* Scope.Scope
    const hold = counted<unknown, Fanned<A>>(fanned, stop)
    return (target: unknown): Stream.Stream<A> =>
      tracedStream(
        Stream.unwrap(Effect.as(Effect.logDebug("wardic.sharedSource.byTarget: subscribe"), subscriberOf(hold, target, () => lookup(target), scope))),
        "wardic.sharedSource.byTarget",
      )
  })

/**
 * One shared source for the whole Environment: a Stream that's hot and counted. The first subscriber
 * starts `acquire`'s source, later ones share it, and it stops when the last one leaves. `byTarget`'s
 * form without a target.
 *
 * @example
 * // `viewportChanges`: an Environment's own Stream of its viewport's size
 * const viewport = yield* SharedSource.make(Effect.succeed(viewportChanges))
 * Stream.runForEach(viewport, onResize) // one listener, however many subscribe
 */
export const make: <A>(
  acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>,
) => Effect.Effect<Stream.Stream<A>, never, Scope.Scope> = /*#__PURE__*/ Effect.fnUntraced(
  function* <A>(acquire: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>) {
    yield* Effect.logDebug("wardic.sharedSource.make: create")
    const scope = yield* Scope.Scope
    const hold = counted<unknown, Fanned<A>>(fanned, stop)
    return tracedStream(
      Stream.unwrap(Effect.as(Effect.logDebug("wardic.sharedSource.make: subscribe"), subscriberOf(hold, undefined, () => acquire, scope))),
      "wardic.sharedSource.make",
    )
  })
