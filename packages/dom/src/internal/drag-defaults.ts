/**
 * The defaults every drag element gets (ADR-0019, *Amendment (Reorder)*, #36), as
 * Motion's draggables do (render/html/use-props.ts:57-73 at
 * 16c61222c4166bbef5ff6ab0051192faa79fa8c8,
 * https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/render/html/use-props.ts#L57-L73):
 * no browser panning on the drag's axes (`touch-action`), so a touch drag isn't taken
 * for a scroll and cancelled; no text selection or iOS callout, so a second drag
 * starting on text the first one selected isn't a native drag; and `draggable="false"`,
 * so an image or link inside doesn't start one. The style maps are kebab-case, for
 * Solid's style objects and the Renderer's `setProperty`. Motion writes them over the
 * user's style; a binding layers them under it, so an app can override one.
 */
import * as Match from "effect/Match"

/** A drag element's default style for its axis. */
export type DragDefaultStyle = Readonly<Record<string, string>>

const styleFor = (touchAction: string): DragDefaultStyle =>
  Object.freeze({
    "touch-action": touchAction,
    "user-select": "none",
    "-webkit-user-select": "none",
    "-webkit-touch-callout": "none",
  })

const FREE = styleFor("none")
// An axis-locked drag keeps the browser's panning on the other axis.
const X = styleFor("pan-y")
const Y = styleFor("pan-x")

/**
 * The default style of a drag element: `touch-action` `none` for a free drag, `pan-y`
 * for an `x` drag and `pan-x` for a `y` drag, with no text selection or iOS callout.
 * One frozen object per axis.
 */
export const dragDefaultStyle: (axis: boolean | "x" | "y") => DragDefaultStyle = Match.type<boolean | "x" | "y">().pipe(
  Match.when("x", () => X),
  Match.when("y", () => Y),
  Match.orElse(() => FREE),
)

/**
 * A Reorder group item's `touch-action` for the group's axis: a `y` list keeps sideways panning, an `x`
 * row vertical panning, and a grid none.
 */
// A **Reorder group**.
export const reorderTouchAction: (axis: "x" | "y" | "xy") => string = Match.type<"x" | "y" | "xy">().pipe(
  Match.when("y", () => "pan-x"),
  Match.when("x", () => "pan-y"),
  Match.orElse(() => "none"),
)

/** The attribute every drag element gets: no native drag of the element or its content. */
export const DRAG_DEFAULT_ATTRIBUTES = Object.freeze({ draggable: "false" } as const)
