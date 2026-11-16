/**
 * Every **Feature** (#511, ADR-0067 decision 2): what a **Complete element** has, and so what its forms
 * (`wardic.*`, `wardic.create`, `createWard`, `use:wardic`, Solid 2's `ward()`) import. A Slim element's
 * forms never do.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/all.ts`, moved to dom with the Features, for
// every DOM binding.
import type * as Feature from "../Feature.ts"
import * as Colors from "./Colors.ts"
import * as Drag from "./Drag.ts"
import * as Focus from "./Focus.ts"
import * as Hover from "./Hover.ts"
import * as InView from "./InView.ts"
import * as Layout from "./Layout.ts"
import * as Pan from "./Pan.ts"
import * as Press from "./Press.ts"

// A tuple, so a Wardic instance's types keep each Feature's name (#516).
export const ALL: readonly [typeof Colors.colors, typeof Layout.layout, typeof Hover.hover, typeof Press.press, typeof Focus.focus, typeof InView.inView, typeof Pan.pan, typeof Drag.drag] = [
  Colors.colors,
  Layout.layout,
  Hover.hover,
  Press.press,
  Focus.focus,
  InView.inView,
  Pan.pan,
  Drag.drag,
]

/** Every Feature: what an element has unless it's a Wardic instance's (#516). */
// #672 (the build grill's Q9): with ALL, so the Feature module imports none of the Features.
export type EveryFeature = typeof ALL

/** The names of every Feature that adds props (#516): what an element has unless it's a Wardic instance's. */
export type EveryFeatureName = Feature.PropFeatureNames<EveryFeature>
