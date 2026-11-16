/**
 * Motion's `domMax` bundle (#511, ADR-0067 decision 3), as a list of Features: every one, as a Complete
 * element has. In a module apart from `domAnimation` (#548).
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/dom-max.ts`, moved to dom with the Features, for
// every DOM binding.
import * as All from "./All.ts"

/** Motion's `domMax`: every Feature, `pan`, `drag`, `layout` and `colors` beside `domAnimation`'s, as a Complete element has. */
export const domMax: typeof All.ALL = All.ALL
