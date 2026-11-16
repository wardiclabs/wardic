/**
 * The gestures' input (#511, ADR-0067 decision 14): what every gesture Feature but `inView` stands on,
 * in a module of its own. `DomLive` no longer builds the DOM's `InputSource`, so an app with no gesture
 * ships none of it. Its top-level calls are marked pure, as every Feature module's are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/input.ts`, moved to dom with the Features, for
// every DOM binding.
import * as InputSource from "@wardic/core/InputSource"
import * as DomInput from "../../DomInput.ts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Feature from "../Feature.ts"

/**
 * The gestures' `InputSource`: the Environment's when it gives one (`@wardic/test`'s `TestLive`, a
 * test's pushed input), else the DOM's, built over the page's `document`. One Layer, so a provider's
 * `MemoMap` builds it once for every gesture Feature it has.
 */
export const input: Layer.Layer<InputSource.InputSource> = /*#__PURE__*/ Feature.fromEnvironmentOr(InputSource.InputSource, DomInput.layer)

/** `watch` with the gestures' input given: what a gesture Feature hands its elements, which run it on their provider. */
export const withInput =
  <Args extends ReadonlyArray<unknown>, A, E, R>(source: InputSource.InputSource["Service"], watch: (...args: Args) => Effect.Effect<A, E, R>) =>
  (...args: Args): Effect.Effect<A, E, Exclude<R, InputSource.InputSource>> =>
    Effect.provideService(watch(...args), InputSource.InputSource, source)

/**
 * A gesture Feature's Layer: its service, made over the gestures' input, which it gives beside it, so
 * a section with the Feature has the input too (a `Reorder` item's keys, a `createPress`).
 */
export const gestureLayer = <I, S>(key: Context.Key<I, S>, make: (source: InputSource.InputSource["Service"]) => S): Layer.Layer<I | InputSource.InputSource, never, Feature.ProviderServices> =>
  Layer.effect(key)(Effect.map(InputSource.InputSource, make)).pipe(Layer.provideMerge(input))
