/**
 * Motion's `domMax` bundle (#511, ADR-0067 decision 3), as a list of Features: every one, as a Complete
 * element has. In a module apart from `domAnimation` (#548).
 *
 * @module
 */
import type { Feature } from "../feature.ts"
import { ALL } from "./all.ts"

/** Motion's `domMax`: every Feature, `pan`, `drag`, `layout` and `colors` beside `domAnimation`'s, as a Complete element has. */
export const domMax: ReadonlyArray<Feature> = ALL
