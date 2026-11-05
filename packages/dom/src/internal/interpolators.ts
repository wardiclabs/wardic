/**
 * The DOM Environment's Interpolators and registry (ADR-0035, ADR-0036): core's built-ins, with the
 * DOM's colours (`cssColor`) before `unit` and the DOM's complex tier (`cssComplex`) in core's
 * place, and the DOM's Key rules. `DomLive` provides the registry. Core names no CSS syntax; this is
 * where the DOM's lives.
 *
 * @module
 */
import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Layer from "effect/Layer"
import { cssColor } from "./colors.ts"
import { cssComplex } from "./complex.ts"
import { keyRules } from "./key-rules.ts"

/**
 * The DOM's kinds of value, in the order they're tried: core's number, array and unit, the DOM's colours
 * before the unit, so `"#fff"` is a colour, and the DOM's complex values last.
 */
// As it was in core before ADR-0036.
export const interpolators: ReadonlyArray<Interpolator.Entry<any, any>> = [
  Interpolator.number,
  Interpolator.array,
  cssColor,
  Interpolator.unit,
  cssComplex,
]

/** The DOM's `InterpolatorRegistry`: its kinds (`interpolators`) and its Key rules (`keyRules`). `DomLive` provides it. */
// ADR-0035.
export const InterpolatorRegistryDomLive: Layer.Layer<InterpolatorRegistry.InterpolatorRegistry> = Layer.effect(
  InterpolatorRegistry.InterpolatorRegistry,
)(InterpolatorRegistry.make(interpolators, keyRules))
