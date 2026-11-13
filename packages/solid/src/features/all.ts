/**
 * Every **Feature** (#511, ADR-0067 decision 2): what a **Complete element** has, and so what its forms
 * (`wardic.*`, `wardic.create`, `createWard`, `use:wardic`, Solid 2's `ward()`) import. A Slim element's
 * forms never do.
 *
 * @module
 */
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
