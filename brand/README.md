# Wardic's logo

Cassiopeia, the W in the northern sky, bound to a ward ring. Its five stars are keyframes, outlined,
sized by the real stars' brightness, and joined into the W. They sit on a dark disc inside a ring that
swells from a hairline at the top to full weight at the bottom. The colours are Nord's Frost and
Aurora, as Northlight, the docs' theme, uses them; Navi, the W's middle star, is gold.

The mark carries its own ground, the disc, so it's the same on light and dark pages.

## Files

| File | For |
| --- | --- |
| `wardic-mark.svg` | The mark, at 48 px and up |
| `wardic-mark-small.svg` | The mark's small cut, at 32 px and under: no faint stars or halos, a heavier ring, lines and stars. The favicon is this file. |
| `wardic-mark-line-snow.svg`, `wardic-mark-line-ink.svg` | One colour, as lines: Snow Storm (`#eceff4`) on dark grounds, Polar Night (`#2e3440`) on light ones |
| `wardic-mark-badge-snow.svg`, `wardic-mark-badge-ink.svg` | One colour, reversed: the mark in the ground's colour on a disc of the other |
| `wardic-lockup-on-dark.svg`, `wardic-lockup-on-light.svg` | The mark and the wordmark, `wardic` in Manrope ExtraBold, outlined, so no font is needed. `@2x.png` copies for places that won't take an SVG. |
| `wardic-lockup-small-on-dark.svg`, `wardic-lockup-small-on-light.svg` | The lockup on the small cut, at 40 px tall and under |
| `apple-touch-icon.png` (180 px), `icon-512.png` | App and touch icons: the mark on its disc's colour, filling the square |

The docs site's header draws the small cut inline, so it can animate (`site/src/components/Logo.tsx`), and
serves the favicon and touch icon from `site/public/`.

## Using it

- Leave room round the mark of at least a quarter of its width.
- Use the small cut below 48 px; the full mark's faint stars and halos blur there.
- Don't recolour, stretch, rotate or outline the mark, and don't set the wordmark in another face.
