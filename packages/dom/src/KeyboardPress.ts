/**
 * A Keyboard press's focusability: `makeFocusable` gives an HTML element that doesn't take the
 * keyboard's focus of itself `tabindex="0"`, so Enter and Space can press it, as Motion's press does. A
 * control, a link with its `href`, an editable region, an element given a `tabindex` and an SVG element
 * are left as they are. `DomInput.makeFocusable` is the same function, here apart from the DOM's input,
 * so a binding calls it as each pressable element mounts without loading the input.
 *
 * @example
 * import * as KeyboardPress from "@wardic/dom/KeyboardPress"
 *
 * const tile = document.createElement("div")
 * KeyboardPress.makeFocusable(tile)
 * // tile.getAttribute("tabindex") === "0"
 */
// `@wardic/dom/KeyboardPress` (#709, Q2; ADR-0056, *Amendment (#709)*): ADR-0041's module per concern.
export { makeFocusable } from "./internal/keyboard-press.ts"
