/**
 * A drag element's defaults (ADR-0019 *Amendment (Reorder)*): the drag axis its binding runs its spine
 * with, the styles and attribute a drag element takes, and their write at mount for an element whose
 * props don't carry them.
 *
 * @module
 */
// #672 (Q11, PR2-Q3): out of `spine.ts`, which never called them, on their way to
// `@wardic/dom/unstable/DragDefaults`.
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardConfig } from "./config.ts"

/** What a `<Reorder>` item adds to an element's drag: its gesture's axis, read at each drag's start. */
interface DragInternals {
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
}

/** A plain element's drag internals: none. */
const NO_DRAG_INTERNALS: DragInternals = {}

/**
 * The drag axis a spine runs with: its static `drag` config, else `true` for a
 * `<Reorder>` item (its gesture's axis comes from `dragAxis`), else none.
 */
export const dragAxisOf = (config: WardConfig, internal: DragInternals = NO_DRAG_INTERNALS): boolean | "x" | "y" | undefined =>
  Option.getOrUndefined(
    Option.orElse(Option.filter(Option.fromUndefinedOr(config.drag), (drag) => drag !== false), () =>
      Option.map(Option.fromUndefinedOr(internal.dragAxis), (): true => true)),
  )

/**
 * A drag element's defaults (ADR-0019 *Amendment (Reorder)*): its axis's, unless its own presses don't
 * drag it (`dragListener={false}`, #431), as Motion's come with its listener.
 */
export const dragDefaultsOf = (config: WardConfig, internal: DragInternals = NO_DRAG_INTERNALS): Style.DragDefaults | undefined => {
  if (config.dragListener === false) return undefined
  return UndefinedOr.map(dragAxisOf(config, internal), Style.dragDefaults)
}

/**
 * Set each of a drag element's defaults its inline style doesn't already set, and
 * `draggable="false"` unless it has the attribute, at mount: for an element whose props don't carry
 * them, a directive's (`use:wardic`, `use:w`) and a `wardic.create(Component)` wrap's, whose
 * component may not pass them on.
 */
export const applyDragDefaults = (element: HTMLElement, defaults: Style.DragDefaults): void => {
  Arr.forEach(Rec.keys(defaults), (key) => {
    if (element.style.getPropertyValue(key) === "") element.style.setProperty(key, UndefinedOr.getOrThrow(defaults[key]))
  })
  if (!element.hasAttribute("draggable")) element.setAttribute("draggable", Style.DRAG_DEFAULT_ATTRIBUTES.draggable)
}
