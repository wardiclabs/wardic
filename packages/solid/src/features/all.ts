/**
 * Every **Feature** (#511, ADR-0067 decision 2): what a **Complete element** has, and so what its forms
 * (`wardic.*`, `wardic.create`, `createWard`, `use:wardic`, Solid 2's `ward()`) import. A Slim element's
 * forms never do.
 *
 * @module
 */
import type { PropFeatureNames } from "../feature.ts"
import { colors } from "./colors.ts"
import { drag } from "./drag.ts"
import { focus } from "./focus.ts"
import { hover } from "./hover.ts"
import { inView } from "./in-view.ts"
import { layout } from "./layout.ts"
import { pan } from "./pan.ts"
import { press } from "./press.ts"

// A tuple, so a Wardic instance's types keep each Feature's name (#516).
export const ALL: readonly [typeof colors, typeof layout, typeof hover, typeof press, typeof focus, typeof inView, typeof pan, typeof drag] = [
  colors,
  layout,
  hover,
  press,
  focus,
  inView,
  pan,
  drag,
]

/** Every Feature: what an element has unless it's a Wardic instance's (#516). */
// #672 (the build grill's Q9): with ALL, so the Feature module imports none of the Features.
export type EveryFeature = typeof ALL

/** The names of every Feature that adds props (#516): what an element has unless it's a Wardic instance's. */
export type EveryFeatureName = PropFeatureNames<EveryFeature>
