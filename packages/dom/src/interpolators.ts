/**
 * The DOM Environment's Interpolators and registry (ADR-0035): core's built-ins, with the complex
 * tier given CSS's `var()` as a span of text (#158, ADR-0035 *Amendment (#158)*), and the DOM's Key
 * rules. `DomLive` provides the registry. Core names no CSS syntax; this is where the DOM's lives.
 *
 * @module
 */
import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Layer from "effect/Layer"
import { keyRules } from "./key-rules.ts"

/**
 * A reference to a custom property, `var(--name)`, with a fallback one bracket level deep (Motion's
 * var token, motion-dom value/types/complex/index.ts `complexRegex` at 16c6122). Inside a complex
 * value it's text: the digits in its name (`--gray-500`) are never numbers (#158).
 */
export const VARIABLE_REFERENCE = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)/

/**
 * Core's complex Interpolator with a `var()` as text (#158): a lone `var()` isn't a complex value,
 * and two blend only with the same count of `var()`s, the target's written as it stands.
 */
export const cssComplex: Interpolator.Entry<Interpolator.Complex, string> = Interpolator.complexWith({ text: [VARIABLE_REFERENCE] })

/** The DOM's Interpolators: core's defaults, in their order, with `cssComplex` in the complex tier's place. */
export const interpolators: ReadonlyArray<Interpolator.Entry<any, any>> = Arr.map(Interpolator.defaults, (entry) =>
  Bool.match(entry === Interpolator.complex, { onTrue: () => cssComplex, onFalse: () => entry }))

/**
 * The DOM Environment's `InterpolatorRegistry` (ADR-0035): its Interpolators (`interpolators`) and
 * its Key rules (`keyRules`). `DomLive` provides it.
 */
export const InterpolatorRegistryDomLive: Layer.Layer<InterpolatorRegistry.InterpolatorRegistry> = Layer.effect(
  InterpolatorRegistry.InterpolatorRegistry,
)(InterpolatorRegistry.make(interpolators, keyRules))
