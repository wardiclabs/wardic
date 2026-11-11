/**
 * A Keyboard press's focusability (#427): the element a press's keys reach must take focus. A module of
 * its own (#709), so a binding makes an element focusable as it mounts without loading the DOM's input.
 *
 * @internal
 */
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"

/** The HTML elements that take the keyboard's focus of themselves (#427): a link only with its `href`. */
const FOCUSABLE_ELEMENTS: ReadonlySet<string> = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "IFRAME"])

/** Whether `el` takes focus of itself: a control, a link, an editable region, or one given a `tabindex`. */
const takesFocus = (el: HTMLElement): boolean =>
  Bool.some([
    FOCUSABLE_ELEMENTS.has(el.tagName),
    Bool.and(Bool.or(el.tagName === "A", el.tagName === "AREA"), el.hasAttribute("href")),
    el.isContentEditable,
    el.hasAttribute("tabindex"),
  ])

/**
 * Makes a pressable element focusable, as Motion's press does: an HTML element that doesn't take focus
 * of itself, with no `tabindex`, gets `tabindex="0"`, so a key can press it. An SVG element, or one
 * already focusable, is left as it is. Called at mount, on the client.
 */
// #427: a **Keyboard press**.
export const makeFocusable = (target: unknown): void => {
  if (Bool.not(Predicate.hasProperty(target, "isContentEditable"))) return
  const el = target as HTMLElement
  if (takesFocus(el)) return
  el.tabIndex = 0
}
