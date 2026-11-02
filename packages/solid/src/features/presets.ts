/**
 * Motion's feature bundles (#511, ADR-0067 decision 3), as lists of Features: give one where a list goes
 * (`features={domAnimation}`, or nested, `features={[domAnimation, layout]}`).
 *
 * @module
 */
import type { Feature } from "../feature.ts"
import { ALL } from "./all.ts"
import { focus } from "./focus.ts"
import { hover } from "./hover.ts"
import { inView } from "./in-view.ts"
import { press } from "./press.ts"

/** Motion's `domAnimation`: the gestures an element animates on without dragging, `hover`, `press`, `focus` and `inView`. */
export const domAnimation: ReadonlyArray<Feature> = [hover, press, focus, inView]

/** Motion's `domMax`: every Feature, `pan`, `drag`, `layout` and `colors` beside `domAnimation`'s, as a Complete element has. */
export const domMax: ReadonlyArray<Feature> = ALL
