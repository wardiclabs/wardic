/**
 * CSS colours: `parse` reads a colour string, `format` writes one, `interpolator` blends two in a colour
 * space, and `TOKEN` finds a colour inside a longer value, a shadow's say. A hex, `rgb()`, `hsl()` and the
 * named colours are colours from the start; `registerSpaces` adds every other CSS colour space, so
 * `oklch()` and `lab()` are colours too, and `interpolator("oklch")` can blend in it.
 *
 * @example
 * import * as Color from "@wardic/dom/Color"
 *
 * Color.parse("#bf616a") // Some({ mode: "rgb", r: 0.749, g: 0.38, b: 0.416 })
 * Color.format({ mode: "rgb", r: 1, g: 0.5, b: 0 }) // "rgb(255, 128, 0)"
 */
// `@wardic/dom/Color` (#132, ADR-0041): a colour Interpolator in a culori mode, the DOM's own (`css`,
// sRGB), its `parse` and `format`, and its token (ADR-0024, ADR-0026); `registerSpaces` (#511).
export {
  color as interpolator,
  cssColor as css,
  type Color,
  formatColor as format,
  parseColor as parse,
  COLOR_TOKEN as TOKEN,
  registerSpaces,
  spacesRegistered,
} from "./internal/colors.ts"
