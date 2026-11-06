/**
 * The DOM's InputSource: pointer, keyboard and focus events as core's own, mapped from the DOM's names by
 * `toPointer`, `keyOf`, `kindOf` and `buttonOf`. It isn't in `DomLive`: a binding builds `layer` with the
 * first gesture an app uses, so an app with none ships no input code.
 *
 * @example
 * import * as DomInput from "@wardic/dom/DomInput"
 *
 * DomInput.keyOf("ArrowLeft") // "left"
 * DomInput.buttonOf(2) // "secondary"
 */
// `@wardic/dom/DomInput` (#132, ADR-0041): ADR-0019, ADR-0036 *Amendment (#189)*, ADR-0037. Not in
// `DomLive`: #511, ADR-0067 decision 14.
export {
  InputDomLive as layer,
  keyOf,
  kindOf,
  makeFocusable,
  buttonOf,
  toPointer,
  type Where,
} from "./internal/input.ts"
