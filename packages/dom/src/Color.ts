/**
 * CSS colours: a colour Interpolator in a culori mode, the DOM's own (`css`, sRGB), the colour
 * string's `parse` and `format` they read and write with, and the token they read (ADR-0024, ADR-0026).
 *
 * `@wardic/dom/Color` (#132, ADR-0041).
 */
export {
  color as interpolator,
  cssColor as css,
  type Color,
  formatColor as format,
  parseColor as parse,
  COLOR_TOKEN as TOKEN,
} from "./internal/colors.ts"
