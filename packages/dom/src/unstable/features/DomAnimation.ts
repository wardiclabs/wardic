/**
 * Motion's `domAnimation` bundle (#511, ADR-0067 decision 3), as a list of Features: give it where a
 * list goes (`features={domAnimation}`, or nested, `features={[domAnimation, layout]}`). In a module
 * apart from `domMax` (#548), so a page given `domAnimation` never ships `domMax`'s Features with it.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/dom-animation.ts`, moved to dom with the Features, for
// every DOM binding.
import * as Focus from "./Focus.ts"
import * as Hover from "./Hover.ts"
import * as InView from "./InView.ts"
import * as Press from "./Press.ts"

/** Motion's `domAnimation`: the gestures an element animates on without dragging, `hover`, `press`, `focus` and `inView`. */
// A tuple, so a Wardic instance's types keep each Feature's name (#516).
export const domAnimation: readonly [typeof Hover.hover, typeof Press.press, typeof Focus.focus, typeof InView.inView] = [Hover.hover, Press.press, Focus.focus, InView.inView]
