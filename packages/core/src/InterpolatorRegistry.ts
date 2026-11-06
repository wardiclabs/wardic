/**
 * The registry of value kinds: given two values, it finds the kind that blends them and returns the
 * blend each frame calls. An Environment builds one over core's kinds and its own (`make`, or `layer`
 * for core's alone), and adds Key rules, which blend a key by its name, as `@wardic/dom`'s keep a key
 * that hides an element at its old value until an animation's last frame. A binding resolves each pair once, as it builds an animation.
 *
 * @example
 * import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
 *
 * const registry = yield* InterpolatorRegistry.InterpolatorRegistry
 * const blend = yield* registry.resolve("0px", "120px")
 * blend(0.5) // "60px"
 */
// ADR-0026 (the pairs), ADR-0035 (Key rules). Tier 2 (ADR-0008): Effect-typed, for binding and
// Environment authors.
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Interpolator from "./Interpolator.ts"
import { dual } from "./internal/dual.ts"

// The registry is heterogeneous by design: its entries are `Interpolator.Entry<any, any>`.

/**
 * The registry of value kinds: a pair of values in, and out the blend each frame calls. A new kind is
 * added by registering it, with no change to the engine.
 */
// `resolve` is the hot-path entry point: it decodes a pair once and returns a pure `(t) => From | To`;
// `interpolate` decodes on every call. `<From, To>` rather than `<T>`, so a mixed pair (`0` → `"10px"`)
// type-checks: the registry picks a kind that produces one of the two, often the string side.
export class InterpolatorRegistry extends Context.Service<InterpolatorRegistry, {
  /** Adds a kind, ahead of those already registered. */
  readonly register: <Decoded, Encoded>(entry: Interpolator.Entry<Decoded, Encoded>) => Effect.Effect<void>
  /**
   * The blend for `from` and `to`: the first kind that reads both, once, and the function each frame
   * calls with its progress. A pair no kind blends switches to `to` at the first frame, with a warning.
   */
  readonly resolve: <From, To>(from: From, to: To) => Effect.Effect<(t: number) => From | To>
  /** `resolve` applied at `t`, once: for a one-off value. It reads both values each call. */
  readonly interpolate: <From, To>(from: From, to: To, t: number) => Effect.Effect<From | To>
  /** Adds a Key rule, ahead of those already registered. */
  // ADR-0035.
  readonly registerKeyRule: (rule: KeyRule) => Effect.Effect<void>
  /**
   * The blend of the first Key rule, latest registered first, that takes `key`'s pair: the Effect
   * that builds it. `None` when every rule declines: the pair blends by value, through `resolve`.
   * Synchronous: it's asked once per key each time a leg is built.
   */
  readonly keyBlendOf: (key: string, from: number | string, to: number | string) => Option.Option<Effect.Effect<KeyBlend>>
  /**
   * Forgets every pair resolved so far, so a pair resolves again when next asked: for when a kind now
   * reads what it didn't, as `@wardic/dom`'s colours do once an app registers more colour spaces.
   */
  // #511.
  readonly forget: Effect.Effect<void>
}>()("@wardic/core/InterpolatorRegistry") {}

/** A key's blend for a whole animation: its value at progress `t`, given whether that's the run's last frame. What a Key rule returns. */
// ADR-0035. On the per-frame path (ADR-0025): plain calls and statement `if`s, nothing allocated but the value.
export type KeyBlend = (t: number, done: boolean) => number | string

/** Resolve a pair by value: the registry's `resolve`, which a Key rule calls for the pairs it blends. */
export type ResolveByValue = <From, To>(from: From, to: To) => Effect.Effect<(t: number) => From | To>

/**
 * A key's pair as the rules after one rule, then the kinds, blend it: what a rule that rewrites a pair
 * hands it on to, so the rules after it still apply. A rule that reads a value from elsewhere, as
 * `@wardic/dom`'s for an element's own variables, resolves it, then blends what it resolved to through
 * `next`, so the key's other rules still apply to it.
 */
// ADR-0035, *Amendment (#55)*: its Animatable none.
export type NextKeyBlend = (key: string, from: number | string, to: number | string) => Effect.Effect<KeyBlend>

/** The first Key rule's blend for a key's pair, or `None`: `keyBlendOf`'s shape. */
export type KeyBlendOf = (key: string, from: number | string, to: number | string) => Option.Option<Effect.Effect<KeyBlend>>

/**
 * An Environment's Key rule: how one key's pair blends, picked by the key's name, as `@wardic/dom`'s keep
 * a key that hides an element at its old value until an animation's last frame. Core holds none: which
 * keys need one is the Environment's to know. Most hold for the whole Environment (`make`, `registerKeyRule`); one that reads an element
 * is added for that element's animations with `withKeyRules`.
 */
// CONTEXT.md, ADR-0035; `@wardic/dom`'s are its `keyRules`. The registry asks every rule for every
// key of every leg it builds, so a key no rule wants costs what it did with none (ADR-0035, *Amendment
// (#55)*).
export interface KeyRule {
  /** Its name, for a warning or a trace. */
  readonly name: string
  /**
   * Whether it takes `key`'s pair: `None` to decline, at once and allocating nothing, or the Effect that
   * builds the key's blend, which may resolve pairs by value through `resolve`, or hand a pair on to the
   * rules after it through `next`.
   */
  readonly blend: (
    key: string,
    from: number | string,
    to: number | string,
    resolve: ResolveByValue,
    next: NextKeyBlend,
  ) => Option.Option<Effect.Effect<KeyBlend>>
}

/** A pair's blend by value, as a `KeyBlend`: what `next` gives when no rule after takes the pair. */
const byValue = (resolve: ResolveByValue, from: number | string, to: number | string): Effect.Effect<KeyBlend> =>
  Effect.map(resolve(from, to), (blend): KeyBlend => (t) => blend(t))

/**
 * `rules` as one `KeyBlendOf`, ahead of `after`: the first rule that takes a key gives its blend,
 * and each rule's `next` is the rules after it, then `after`, then by value. Built once, when the
 * rules are; asking it allocates nothing but what a rule that takes the key does. A statement `if`,
 * not `Option` combinators: it runs for every key of every leg (#61's bench).
 */
const chainOf = (rules: ReadonlyArray<KeyRule>, resolve: ResolveByValue, after: KeyBlendOf): KeyBlendOf =>
  Arr.reduceRight(rules, after, (rest: KeyBlendOf, rule): KeyBlendOf => {
    const next: NextKeyBlend = (key, from, to) => Option.getOrElse(rest(key, from, to), () => byValue(resolve, from, to))
    return (key, from, to) => {
      const taken = rule.blend(key, from, to, resolve, next)
      if (Option.isSome(taken)) return taken
      return rest(key, from, to)
    }
  })

/** No rule: what a chain ends with. */
const noRule: KeyBlendOf = () => Option.none()

/**
 * A Discrete pair at progress `t` (ADR-0024, decision 3): `from` at 0 and below, then `to` from
 * the first frame past 0, as Motion's `mixImmediate`. On the per-frame path (ADR-0025), so a
 * statement `if` rather than a match: nothing allocated per call.
 */
const discrete = <From, To>(from: From, to: To, t: number): From | To => {
  if (t > 0) return to
  return from
}

/** A blend from `from` to `to` at progress `t`: what `resolve` returns. */
type Blend<From, To> = (t: number) => From | To

/** A Discrete pair's blend: `from`, then `to` from the first frame past 0 (ADR-0024, decision 3). */
const discreteBlend =
  <From, To>(from: From, to: To): Blend<From, To> =>
  (t) =>
    discrete(from, to, t)

/** A pair as the entry that takes it read it. */
interface DecodedPair {
  readonly entry: Interpolator.Entry<any, any>
  readonly from: unknown
  readonly to: unknown
}

/** Both endpoints, read by one entry's `parse`: `to` only once `from` reads. */
const decodedBy =
  (from: unknown, to: unknown) =>
  (entry: Interpolator.Entry<any, any>): Option.Option<DecodedPair> =>
    Option.flatMap(entry.parse(from), (decodedFrom) =>
      Option.map(entry.parse(to), (decodedTo) => ({ entry, from: decodedFrom, to: decodedTo })),
    )

/**
 * The entry a pair resolves to (ADR-0026, decision 3): the first, in registry precedence, whose
 * `parse` reads both endpoints, with what it read. Reading is matching, so `0` → `"10px"` resolves
 * to `unit`, whose `parse` reads a bare number too.
 *
 * `None` when no entry reads both: a Discrete pair, which switches to `to` at the first frame
 * past 0 (ADR-0024 decision 3; Motion's `mixImmediate`).
 */
const select = (entries: ReadonlyArray<Interpolator.Entry<any, any>>, from: unknown, to: unknown): Option.Option<DecodedPair> =>
  Arr.findFirst(entries, decodedBy(from, to))

/**
 * A pair's blend from the entry that decodes both endpoints. When the entry can't blend them
 * (two units, two structures), the pair is a Discrete pair, and `resolve` warns: Motion warns on a
 * pair "too different to mix" (ADR-0026, decision 4). A pair of strings warns once per registry,
 * since the cache keeps it (decision 9).
 */
const blendDecoded = <From, To>(decoded: DecodedPair, from: From, to: To): Effect.Effect<Blend<From, To>> =>
  Option.match(decoded.entry.blend(decoded.from, decoded.to), {
    onSome: (blend) => Effect.succeed(blend),
    onNone: () =>
      Effect.logWarning("wardic.interpolator: can't blend a pair it decodes; it switches at the first frame").pipe(
        Effect.annotateLogs({ interpolator: decoded.entry.name, from, to }),
        Effect.as(discreteBlend(from, to)),
      ),
  })

/** How many string pairs a registry keeps resolved before it starts over (ADR-0026, decision 9). */
const CACHE_CAPACITY = 1024

/**
 * Resolved blends of string pairs, by `from`, then `to` (ADR-0026, decision 9). Elements often
 * animate the same pair (a hover state's value, say), so each pair is decoded
 * and built once per registry, and every stream that resolves it shares the closure. That's safe:
 * the closures are pure, and `complex`'s, which reuses one numbers array, rewrites every number and
 * formats them within each call.
 *
 * - Strings only: a number resolves in well under a microsecond, and an array is keyed by identity.
 * - Two `Map`s rather than one string key, so nothing is built to look a pair up.
 * - At capacity it starts over, and `register` empties it, since precedence changes.
 */
interface BlendCache {
  /** Per key, each leg (#460): the blend, or `undefined`, nothing made. */
  readonly get: (from: string, to: string) => Blend<any, any> | undefined
  readonly set: (from: string, to: string, blend: Blend<any, any>) => void
  readonly clear: () => void
}

const makeBlendCache = (capacity: number): BlendCache => {
  const rows = new Map<string, Map<string, Blend<any, any>>>()
  const size = MutableRef.make(0)
  const clear = () => {
    rows.clear()
    MutableRef.set(size, 0)
  }
  /** `from`'s row, made when it has none. */
  const rowOf = (from: string): Map<string, Blend<any, any>> =>
    Option.getOrElse(Option.fromUndefinedOr(rows.get(from)), () => {
      const row = new Map<string, Blend<any, any>>()
      rows.set(from, row)
      return row
    })
  return {
    get: (from, to) => {
      const row = rows.get(from)
      if (Predicate.isUndefined(row)) return undefined
      return row.get(to)
    },
    set: (from, to, blend) => {
      if (MutableRef.get(size) >= capacity) clear()
      rowOf(from).set(to, blend)
      MutableRef.increment(size)
    },
    clear,
  }
}

/**
 * A registry over `initial`, core's kinds by default, and `keyRules`, each in precedence order: the
 * first that takes a pair wins, and `register` and `registerKeyRule` add ahead. A pair is resolved by
 * the first kind that reads both of it, once; a pair of strings is resolved once per registry and kept.
 *
 * @example
 * const registry = yield* InterpolatorRegistry.make([colors, ...Interpolator.defaults], displayRules)
 */
// `resolve` is the hot-path entry, returning the pure `(t) => From | To` its `blend` built, which only
// blends and encodes per frame (ADR-0026); a pair no entry decodes both of is a Discrete pair; the string
// cache is decision 9.
export const make = (
  initial: ReadonlyArray<Interpolator.Entry<any, any>> = Interpolator.defaults,
  keyRules: ReadonlyArray<KeyRule> = [],
) =>
  Effect.sync(() => {
    const entries: Array<Interpolator.Entry<any, any>> = Arr.copy(initial)
    const rules: Array<KeyRule> = Arr.copy(keyRules)
    const cache = makeBlendCache(CACHE_CAPACITY)
    // The rules as one chain, built again when one is registered.
    const chain = MutableRef.make<KeyBlendOf>(noRule)

    // Per key, each leg (#460, compose once): statements.
    const resolveUncached = <From, To>(from: From, to: To): Effect.Effect<Blend<From, To>> => {
      const decoded = select(entries, from, to)
      if (Option.isNone(decoded)) return Effect.succeed(discreteBlend(from, to))
      return blendDecoded(decoded.value, from, to)
    }

    /** A pair of strings, from the cache, or resolved and kept. */
    const resolveCached = (from: string, to: string): Effect.Effect<Blend<any, any>> => {
      const kept = cache.get(from, to)
      if (Predicate.isNotUndefined(kept)) return Effect.succeed(kept)
      return Effect.tap(resolveUncached(from, to), (blend) => Effect.sync(() => cache.set(from, to, blend)))
    }

    const resolve = <From, To>(from: From, to: To): Effect.Effect<Blend<From, To>> =>
      Effect.suspend(() => {
        if (Predicate.isString(from) && Predicate.isString(to)) return resolveCached(from, to)
        return resolveUncached(from, to)
      })

    MutableRef.set(chain, chainOf(rules, resolve, noRule))

    return {
      register: Effect.fnUntraced(function* <Decoded, Encoded>(entry: Interpolator.Entry<Decoded, Encoded>) {
        entries.unshift(entry)
        cache.clear()
        yield* Effect.logDebug("wardic.interpolator: register").pipe(
          Effect.annotateLogs({ interpolator: entry.name }),
        )
      }),
      resolve,
      interpolate: <From, To>(from: From, to: To, t: number): Effect.Effect<From | To> =>
        Effect.map(resolve(from, to), (blend) => blend(t)),
      registerKeyRule: Effect.fnUntraced(function* (rule: KeyRule) {
        rules.unshift(rule)
        MutableRef.set(chain, chainOf(rules, resolve, noRule))
        yield* Effect.logDebug("wardic.interpolator: register key rule").pipe(
          Effect.annotateLogs({ keyRule: rule.name }),
        )
      }),
      keyBlendOf: (key: string, from: number | string, to: number | string): Option.Option<Effect.Effect<KeyBlend>> =>
        MutableRef.get(chain)(key, from, to),
      forget: Effect.sync(() => cache.clear()),
    }
  })

/**
 * `self` run with `rules` asked first, ahead of the registry's own Key rules, for that run alone: how a
 * binding adds a rule bound to one element, as `@wardic/dom`'s for its own variables, to that element's
 * animations.
 * Each rule's `next` is the rules after it, then the registry's, then by value. The registry itself is
 * unchanged, so one element's rule never reaches another's.
 *
 * @example
 * yield* buildLegs.pipe(InterpolatorRegistry.withKeyRules([ruleOf(element)]))
 */
// ADR-0035, *Amendment (#55)*: `@wardic/dom`'s `variableValues(element)`.
export const withKeyRules: {
  (rules: ReadonlyArray<KeyRule>): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | InterpolatorRegistry>
  <A, E, R>(self: Effect.Effect<A, E, R>, rules: ReadonlyArray<KeyRule>): Effect.Effect<A, E, R | InterpolatorRegistry>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, rules: ReadonlyArray<KeyRule>): Effect.Effect<A, E, R | InterpolatorRegistry> =>
    Effect.updateService(self, InterpolatorRegistry, (registry) => layeredOf(rules, registry)),
)

/** A registry service, as `withKeyRules` reads and provides it. */
type Service = InterpolatorRegistry["Service"]

/**
 * Each rule list's layered registries, by the registry under them: a binding binds one list to an
 * element and wraps each leg it starts with it, so the chain is built once per element and
 * Environment, not per leg. Weak, so an element's list goes with it.
 */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const layered = new WeakMap<ReadonlyArray<KeyRule>, WeakMap<Service, Service>>()

/** `registry` with `rules` asked first: kept per rule list and registry. */
const layeredOf = (rules: ReadonlyArray<KeyRule>, registry: Service): Service => {
  // Per leg (#460): statements.
  let byRegistry = layered.get(rules)
  if (Predicate.isUndefined(byRegistry)) {
    byRegistry = new WeakMap<Service, Service>()
    layered.set(rules, byRegistry)
  }
  const kept = byRegistry.get(registry)
  if (Predicate.isNotUndefined(kept)) return kept
  const made: Service = { ...registry, keyBlendOf: chainOf(rules, registry.resolve, registry.keyBlendOf) }
  byRegistry.set(registry, made)
  return made
}

/** The `InterpolatorRegistry` pre-loaded with core's built-in interpolators (`Interpolator.defaults`) and no Key rules. */
export const layer: Layer.Layer<InterpolatorRegistry> = Layer.effect(InterpolatorRegistry)(make())
