/**
 * The `InterpolatorRegistry` module: the service that resolves a pair of values to the blend a
 * frame calls (ADR-0026), and a key's pair to its Environment's Key rule (ADR-0035); `make` to
 * build one over a list of `Interpolator.Entry`s and `KeyRule`s, and `layer`, one pre-loaded with
 * `Interpolator.defaults` and no Key rules.
 *
 * Tier 2 (ADR-0008): Effect-typed, for binding and Environment authors.
 */
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Interpolator from "./Interpolator.ts"
import { dual } from "./internal/dual.ts"

// The registry is heterogeneous by design: its entries are `Interpolator.Entry<any, any>`.

/**
 * Registry of value-kind interpolators. The engine resolves the interpolation
 * strategy for a value through this service rather than hard-coding type checks,
 * so new value kinds are added by registering an entry — no engine changes.
 *
 * `resolve` is the hot-path entry point: it decodes a `from`/`to` pair once, picks
 * the entry that decodes it, and returns a pure `(t) => From | To`. `interpolate`
 * is sugar that resolves and applies in one step for callers that already have `t`;
 * it decodes on every call.
 *
 * The signature is intentionally `<From, To>` rather than `<T>` so mixed-type
 * pairs (`0` → `"10px"`) type-check cleanly — pair-aware selection in the
 * registry picks an interpolator that can produce one of the input value types
 * (often the string side, after coercion), which `From | To` honestly reflects.
 */
export class InterpolatorRegistry extends Context.Service<InterpolatorRegistry, {
  readonly register: <Decoded, Encoded>(entry: Interpolator.Entry<Decoded, Encoded>) => Effect.Effect<void>
  readonly resolve: <From, To>(from: From, to: To) => Effect.Effect<(t: number) => From | To>
  readonly interpolate: <From, To>(from: From, to: To, t: number) => Effect.Effect<From | To>
  /** Add a Key rule, ahead of those already registered (ADR-0035). */
  readonly registerKeyRule: (rule: KeyRule) => Effect.Effect<void>
  /**
   * The blend of the first Key rule, latest registered first, that takes `key`'s pair: the Effect
   * that builds it. `None` when every rule declines: the pair blends by value, through `resolve`.
   * Synchronous: it's asked once per key each time a leg is built.
   */
  readonly keyBlendOf: (key: string, from: number | string, to: number | string) => Option.Option<Effect.Effect<KeyBlend>>
}>()("@wardic/InterpolatorRegistry") {}

/**
 * A key's blend for a whole leg (ADR-0035): its value at progress `t`, given whether that progress
 * Frame is the run's last. What a Key rule hands back, and on the per-frame path (ADR-0025): plain
 * calls and statement `if`s, nothing allocated but the value.
 */
export type KeyBlend = (t: number, done: boolean) => number | string

/** Resolve a pair by value: the registry's `resolve`, which a Key rule calls for the pairs it blends. */
export type ResolveByValue = <From, To>(from: From, to: To) => Effect.Effect<(t: number) => From | To>

/**
 * A key's pair as the rules after one rule, then the Interpolators, blend it (ADR-0035, *Amendment
 * (#55)*): what a rule that rewrites a pair hands it on to, so the rules after it still apply. The
 * DOM's element-bound rule resolves a Variable value, then blends what it resolved to through
 * `next`, so `"none"` → `var(--shadow)` still grows from its Animatable none.
 */
export type NextKeyBlend = (key: string, from: number | string, to: number | string) => Effect.Effect<KeyBlend>

/** The first Key rule's blend for a key's pair, or `None`: `keyBlendOf`'s shape. */
export type KeyBlendOf = (key: string, from: number | string, to: number | string) => Option.Option<Effect.Effect<KeyBlend>>

/**
 * An Environment's **Key rule** (CONTEXT.md, ADR-0035): how one key's pair blends, picked by the
 * key's name. Core holds none; the DOM Environment's know CSS properties (`@wardic/dom`'s
 * `keyRules`).
 *
 * `blend` declines with `None`, synchronously and allocating nothing: the registry asks every rule
 * for every key of every leg it builds, so a key no rule wants costs what it did with none. Taking
 * the key, it returns the Effect that builds the key's `KeyBlend`, which may resolve pairs by value
 * through `resolve`, or hand a pair on through `next` to the rules after it (ADR-0035, *Amendment
 * (#55)*).
 *
 * Most rules hold for the whole Environment (`make`, `registerKeyRule`). A rule that reads an element
 * is bound to it for a run instead, with {@link withKeyRules}.
 */
export interface KeyRule {
  readonly name: string
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

/** A registered entry, with its codec's decoder built once, when it's registered. */
interface Registered {
  readonly entry: Interpolator.Entry<any, any>
  readonly decode: (value: unknown) => Option.Option<unknown>
}

const registered = (entry: Interpolator.Entry<any, any>): Registered => ({
  entry,
  decode: Schema.decodeUnknownOption(entry.codec),
})

/** A pair as the entry that takes it decodes it. */
interface DecodedPair {
  readonly entry: Interpolator.Entry<any, any>
  readonly from: unknown
  readonly to: unknown
}

/** Both endpoints, decoded by one entry's codec: `to` only once `from` decodes. */
const decodedBy =
  (from: unknown, to: unknown) =>
  (registered: Registered): Option.Option<DecodedPair> =>
    Option.flatMap(registered.decode(from), (decodedFrom) =>
      Option.map(registered.decode(to), (decodedTo) => ({ entry: registered.entry, from: decodedFrom, to: decodedTo })),
    )

/**
 * The entry a pair resolves to (ADR-0026, decision 3): the first, in registry precedence, whose
 * codec decodes both endpoints, with what it decoded. Decoding is matching, so `0` → `"10px"`
 * resolves to `unit`, whose codec decodes a bare number too.
 *
 * `None` when no entry decodes both: a Discrete pair, which switches to `to` at the first frame
 * past 0 (ADR-0024 decision 3; Motion's `mixImmediate`).
 */
const select = (entries: ReadonlyArray<Registered>, from: unknown, to: unknown): Option.Option<DecodedPair> =>
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
 * animate the same pair (a hover state's value, `display`), so each pair is decoded
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
 * Builds the `InterpolatorRegistry` service shape over a mutable entry list and a mutable Key
 * rule list, each in precedence order (`keyRules` as given: the first that takes a key wins).
 * `register` and `registerKeyRule` prepend, so later registrations take precedence.
 *
 * `resolve` is the hot-path entry: it picks the first entry that decodes both
 * endpoints, once, and returns the pure `(t) => From | To` its `blend` built,
 * which only blends and encodes per frame (ADR-0026). A pair no entry decodes
 * both endpoints of is a Discrete pair. A pair of strings is resolved once per
 * registry and kept (decision 9). `interpolate` is sugar — the same `resolve`,
 * applied once.
 */
export const make = (
  initial: ReadonlyArray<Interpolator.Entry<any, any>> = Interpolator.defaults,
  keyRules: ReadonlyArray<KeyRule> = [],
) =>
  Effect.sync(() => {
    const entries: Array<Registered> = Arr.map(initial, registered)
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
        entries.unshift(registered(entry))
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
    }
  })

/**
 * Run `self` with `rules` asked first, ahead of the registry's own Key rules, for that run only
 * (ADR-0035, *Amendment (#55)*): how a binding adds a rule bound to one element, the DOM's
 * `variableValues(element)`, to each leg it builds. Each rule's `next` is the rules after it, then
 * the registry's rules, then by value. The registry itself isn't changed, so one element's rule never
 * reaches another's legs.
 */
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
