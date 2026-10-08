import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { InterpolatorRegistry } from "../services/InterpolatorRegistry.ts"
import type { InterpolatorEntry } from "../services/InterpolatorRegistry.ts"
import { arrayInterpolator } from "./array.ts"
import { colorInterpolator } from "./color.ts"
import { complexInterpolator } from "./complex.ts"
import { discrete } from "./discrete.ts"
import { numberInterpolator } from "./number.ts"
import { unitInterpolator } from "./unit.ts"

// The registry is heterogeneous by design: its entries are `InterpolatorEntry<any, any>`.

/**
 * The interpolators core ships with, in resolution order. `number` and `array`
 * are checked first (cheap, unambiguous); `color` before `unit` so `"#fff"`
 * routes to color while `"10px"` routes to unit; `complex` LAST so it only
 * catches multi-number structural strings (SVG `d`/`points`, `filter`,
 * `box-shadow`) the specific entries didn't claim (ADR-0015).
 */
export const defaultInterpolators: ReadonlyArray<InterpolatorEntry<any, any>> = [
  numberInterpolator,
  arrayInterpolator,
  colorInterpolator("rgb"),
  unitInterpolator,
  complexInterpolator,
]

/** A blend from `from` to `to` at progress `t`: what `resolve` returns. */
type Blend<From, To> = (t: number) => From | To

/** A Discrete pair's blend: `from`, then `to` from the first frame past 0 (ADR-0024, decision 3). */
const discreteBlend =
  <From, To>(from: From, to: To): Blend<From, To> =>
  (t) =>
    discrete(from, to, t)

/** A registered entry, with its codec's decoder built once, when it's registered. */
interface Registered {
  readonly entry: InterpolatorEntry<any, any>
  readonly decode: (value: unknown) => Option.Option<unknown>
}

const registered = (entry: InterpolatorEntry<any, any>): Registered => ({
  entry,
  decode: Schema.decodeUnknownOption(entry.codec),
})

/** A pair as the entry that takes it decodes it. */
interface DecodedPair {
  readonly entry: InterpolatorEntry<any, any>
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
 * animate the same pair (a hover colour, `display`), so each pair is decoded
 * and built once per registry, and every stream that resolves it shares the closure. That's safe:
 * the closures are pure, and `complex`'s, which reuses one numbers array, rewrites every number and
 * formats them within each call.
 *
 * - Strings only: a number resolves in well under a microsecond, and an array is keyed by identity.
 * - Two `Map`s rather than one string key, so nothing is built to look a pair up.
 * - At capacity it starts over, and `register` empties it, since precedence changes.
 */
interface BlendCache {
  readonly get: (from: string, to: string) => Option.Option<Blend<any, any>>
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
    get: (from, to) => Option.flatMap(Option.fromUndefinedOr(rows.get(from)), (row) => Option.fromUndefinedOr(row.get(to))),
    set: (from, to, blend) => {
      if (MutableRef.get(size) >= capacity) clear()
      rowOf(from).set(to, blend)
      MutableRef.increment(size)
    },
    clear,
  }
}

type Pair = readonly [from: unknown, to: unknown]

/** Two strings: a pair the registry's cache keeps. */
const stringPair: Predicate.Refinement<Pair, readonly [string, string]> = Predicate.Tuple([
  Predicate.isString,
  Predicate.isString,
])

/**
 * Builds the `InterpolatorRegistry` service shape over a mutable entry list.
 * `register` prepends, so later registrations take precedence over built-ins.
 *
 * `resolve` is the hot-path entry: it picks the first entry that decodes both
 * endpoints, once, and returns the pure `(t) => From | To` its `blend` built,
 * which only blends and encodes per frame (ADR-0026). A pair no entry decodes
 * both endpoints of is a Discrete pair. A pair of strings is resolved once per
 * registry and kept (decision 9). `interpolate` is sugar — the same `resolve`,
 * applied once.
 */
export const makeInterpolatorRegistry = (initial: ReadonlyArray<InterpolatorEntry<any, any>> = defaultInterpolators) =>
  Effect.sync(() => {
    const entries: Array<Registered> = Arr.map(initial, registered)
    const cache = makeBlendCache(CACHE_CAPACITY)

    const resolveUncached = <From, To>(from: From, to: To): Effect.Effect<Blend<From, To>> =>
      Option.match(select(entries, from, to), {
        onNone: () => Effect.succeed(discreteBlend(from, to)),
        onSome: (decoded) => blendDecoded(decoded, from, to),
      })

    /** A pair of strings, from the cache, or resolved and kept. */
    const resolveCached = ([from, to]: readonly [string, string]): Effect.Effect<Blend<any, any>> =>
      Option.match(cache.get(from, to), {
        onSome: (blend) => Effect.succeed(blend),
        onNone: () => Effect.tap(resolveUncached(from, to), (blend) => Effect.sync(() => cache.set(from, to, blend))),
      })

    const resolve = <From, To>(from: From, to: To): Effect.Effect<Blend<From, To>> =>
      Effect.suspend(() => {
        const pair: Pair = [from, to]
        return Option.match(Option.liftPredicate(pair, stringPair), {
          onNone: () => resolveUncached(from, to),
          onSome: resolveCached,
        })
      })

    return {
      register: <Decoded, Encoded>(entry: InterpolatorEntry<Decoded, Encoded>) =>
        Effect.gen(function* () {
          entries.unshift(registered(entry))
          cache.clear()
          yield* Effect.logDebug("wardic.interpolator: register").pipe(
            Effect.annotateLogs({ interpolator: entry.name }),
          )
        }),
      resolve,
      interpolate: <From, To>(from: From, to: To, t: number): Effect.Effect<From | To> =>
        Effect.map(resolve(from, to), (blend) => blend(t)),
    }
  })

/** `InterpolatorRegistry` Layer pre-loaded with core's built-in interpolators. */
export const InterpolatorRegistryLive: Layer.Layer<InterpolatorRegistry> = Layer.effect(
  InterpolatorRegistry,
)(makeInterpolatorRegistry())
