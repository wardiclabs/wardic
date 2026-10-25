/**
 * The site's micro-interactions (#365): plain variant data both apps hand Wardic, so the shop's own
 * chrome (its gallery cards, its header buttons, its back links) answers a hover, a focus and a press
 * with a spring, beside the demos. The header's Reduce motion switch reaches them as it reaches the
 * demos.
 */

/** A quick, settled spring for everything here. */
const SPRING = { type: "spring", stiffness: 420, damping: 30 } as const

/**
 * A gallery card: it lifts and glows (`--glow`, a custom property the stylesheet turns into the
 * accent's halo), its tags rise one after another, the hover's name passing down to them, and a
 * press sinks it a little.
 */
export const CARD = {
  rest: { y: 0, scale: 1, "--glow": 0, transition: { ...SPRING, staggerChildren: 0.02, staggerDirection: -1 as const } },
  hover: { y: -4, scale: 1, "--glow": 1, transition: { ...SPRING, staggerChildren: 0.03 } },
  press: { y: -1, scale: 0.98, "--glow": 1, transition: SPRING },
}

/** A card's tag: it rises with its card's hover, in turn. */
export const TAG = {
  rest: { y: 0, transition: SPRING },
  hover: { y: -2, transition: SPRING },
}

/** A header icon button: it grows under the pointer and gives under a press. */
export const ICON = {
  rest: { scale: 1, transition: SPRING },
  hover: { scale: 1.08, transition: SPRING },
  press: { scale: 0.92, transition: SPRING },
}

/** The settings cog, turning as its button is hovered. */
export const COG = {
  rest: { rotate: 0, transition: SPRING },
  hover: { rotate: 60, transition: SPRING },
}

/** A back link's arrow, nudged toward where it goes. */
export const BACK = {
  rest: { x: 0, transition: SPRING },
  hover: { x: -3, transition: SPRING },
}

/** The theme icon's turn, half a turn per switch. */
export const turnOf = (switches: number) => ({ rotate: switches * 180, transition: SPRING })
