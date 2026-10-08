import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
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
 * (two units, two structures), the pair is a Discrete pair, and `resolve` warns once: Motion warns
 * on a pair "too different to mix" (ADR-0026, decision 4).
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

/**
 * Builds the `InterpolatorRegistry` service shape over a mutable entry list.
 * `register` prepends, so later registrations take precedence over built-ins.
 *
 * `resolve` is the hot-path entry: it picks the first entry that decodes both
 * endpoints, once, and returns the pure `(t) => From | To` its `blend` built,
 * which only blends and encodes per frame (ADR-0026). A pair no entry decodes
 * both endpoints of is a Discrete pair. `interpolate` is sugar — the same
 * `resolve`, applied once, so it decodes on every call.
 */
export const makeInterpolatorRegistry = (initial: ReadonlyArray<InterpolatorEntry<any, any>> = defaultInterpolators) =>
  Effect.sync(() => {
    const entries: Array<Registered> = Arr.map(initial, registered)

    const resolve = <From, To>(from: From, to: To): Effect.Effect<Blend<From, To>> =>
      Effect.suspend(() =>
        Option.match(select(entries, from, to), {
          onNone: () => Effect.succeed(discreteBlend(from, to)),
          onSome: (decoded) => blendDecoded(decoded, from, to),
        }),
      )

    return {
      register: <Decoded, Encoded>(entry: InterpolatorEntry<Decoded, Encoded>) =>
        Effect.gen(function* () {
          entries.unshift(registered(entry))
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
