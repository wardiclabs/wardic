/**
 * Motion's `domAnimation` bundle (#511, ADR-0067 decision 3), as a list of Features: give it where a
 * list goes (`features={domAnimation}`, or nested, `features={[domAnimation, layout]}`). In a module
 * apart from `domMax` (#548), so a page given `domAnimation` never ships `domMax`'s Features with it.
 *
 * @module
 */
import { focus } from "./focus.ts"
import { hover } from "./hover.ts"
import { inView } from "./in-view.ts"
import { press } from "./press.ts"

/** Motion's `domAnimation`: the gestures an element animates on without dragging, `hover`, `press`, `focus` and `inView`. */
// A tuple, so a Wardic instance's types keep each Feature's name (#516).
export const domAnimation: readonly [typeof hover, typeof press, typeof focus, typeof inView] = [hover, press, focus, inView]
