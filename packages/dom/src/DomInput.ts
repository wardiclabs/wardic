/**
 * The DOM's `InputSource`: pointer, keyboard and focus events in core's own words (ADR-0019, ADR-0036 *Amendment (#189)*, ADR-0037), and the mappings from the DOM's names.
 *
 * `@wardic/dom/DomInput` (#132, ADR-0041).
 */
export {
  InputDomLive as layer,
  keyOf,
  kindOf,
  makeFocusable,
  buttonOf,
  toPointer,
} from "./internal/input.ts"
