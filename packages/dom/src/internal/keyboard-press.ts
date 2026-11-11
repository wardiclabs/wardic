/**
 * A Keyboard press's focusability (#427): the element a press's keys reach must take focus. A module of
 * its own (#709), so a binding makes an element focusable as it mounts without loading the DOM's input.
 *
 * @internal
 */
import * as Predicate from "effect/Predicate"

/** The HTML elements that take the keyboard's focus of themselves (#427). */
const FOCUSABLE_ELEMENTS: ReadonlySet<string> = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "IFRAME"])

/** The links, which take focus with their `href`. */
const LINK_ELEMENTS: ReadonlySet<string> = new Set(["A", "AREA"])

/** Whether `el` takes focus of itself: a control, one given a `tabindex`, a link, or an editable region. */
const takesFocus = (el: HTMLElement): boolean => {
  // Per pressable element at mount (#709): statements, the cheapest reads first, each only if needed.
  const tag = el.tagName
  if (FOCUSABLE_ELEMENTS.has(tag)) return true
  if (el.hasAttribute("tabindex")) return true
  if (LINK_ELEMENTS.has(tag)) {
    if (el.hasAttribute("href")) return true
  }
  return el.isContentEditable
}

/** Whether `target` is an HTML element: `Predicate.hasProperty(target, "isContentEditable")`'s own test. */
const isHtmlElement = (target: unknown): target is HTMLElement => {
  // Per pressable element at mount (#709): statements, without `hasProperty`'s `dual` call.
  return Predicate.isObjectKeyword(target) && "isContentEditable" in target
}

/**
 * Makes a pressable element focusable, as Motion's press does: an HTML element that doesn't take focus
 * of itself, with no `tabindex`, gets `tabindex="0"`, so a key can press it. An SVG element, or one
 * already focusable, is left as it is. Called at mount, on the client.
 */
// #427: a **Keyboard press**.
export const makeFocusable = (target: unknown): void => {
  // Per pressable element at mount (#709): statements.
  if (isHtmlElement(target)) {
    if (takesFocus(target)) return
    target.tabIndex = 0
  }
}
