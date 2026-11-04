/**
 * The **`colors` Feature** (#511, ADR-0067 decision 5), in a module of its own: an app that never
 * imports it ships none of its colour spaces. Its top-level calls are marked pure: without the marks,
 * Rollup kept `registerSpaces` and every space's definition for the callback `Effect.sync` is given,
 * though nothing of the module's was emitted (1 KB gzipped on a Slim element's app).
 *
 * @module
 */
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Color from "@wardic/dom/Color"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Feature } from "../feature.ts"
import { Colors } from "./keys.ts"

/**
 * Every CSS colour space beyond a hex, `rgb()`, `hsl()` and the colour names, which every element
 * reads: `oklch()`, `lab()`, `lch()`, `oklab()`, `hwb()` and `color()`'s spaces (`display-p3`,
 * `rec2020` …). Blends don't change: every colour blends in sRGB. culori
 * keeps its spaces in one registry for the page, so once one provider, or a server render, registers
 * them, every element on the page reads them; a pair another provider resolved before stays as it
 * was resolved there.
 */
export const colors: Feature<Colors, true> = {
  name: "colors",
  key: Colors,
  // The provider's registry forgets the pairs it resolved before: one with a wide-gamut colour read as
  // a complex value then is a colour from now on (decision 8, "from then on").
  layer: /*#__PURE__*/ Layer.effect(Colors)(
    /*#__PURE__*/ Effect.flatMap(InterpolatorRegistry.InterpolatorRegistry, (registry) => {
      Color.registerSpaces()
      return Effect.as(registry.forget, true as const)
    }),
  ),
  server: Color.registerSpaces,
}
