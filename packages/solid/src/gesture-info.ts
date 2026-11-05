/**
 * The info a gesture event hands over (#257, #273): Motion's `EventInfo` / `TapInfo` and `PanInfo` (a
 * drag's and a pan's), with the pointer's `point` in the viewport (`clientX` / `clientY`, as
 * `getBoundingClientRect()` measures), not the page as Motion's: both bindings, grilled B on each
 * (ADR-0046, ADR-0047). Solid 1's callbacks and Solid 2's `next(name)` both build it here.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import type * as Recognizer from "@wardic/core/Recognizer"

/** A point in the viewport. */
export interface WardicPoint {
  readonly x: number
  readonly y: number
}

/** A hover's or a press's event: where the pointer was, in the viewport. */
export interface WardicPointInfo {
  readonly point: WardicPoint
}

/**
 * A drag's event: where the pointer was, in the viewport, and the drag's `offset` from its down, its
 * last `delta` and its `velocity` (px/s). A scroll during the drag counts as movement in `offset`, as
 * Motion's does; `point` stays where the pointer is on the screen. A one-axis drag's are zeroed off
 * its axis.
 */
export interface WardicDragInfo {
  readonly point: WardicPoint
  readonly offset: WardicPoint
  readonly delta: WardicPoint
  readonly velocity: WardicPoint
}

/** How a press was made: by a pointer, or a **Keyboard press**. */
export type WardicPressInput = "pointer" | "keyboard"

/**
 * A press's event: where it was, in the viewport, and how it was made. A **Keyboard
 * press**'s point is its element's centre, measured at the key, so code that places something at a
 * press works for one.
 */
export interface WardicPressInfo extends WardicPointInfo {
  readonly input: WardicPressInput
}

/**
 * The platform's event a press's callback hears: a pointer's; a **Keyboard press**'s key, or
 * the blur that cancelled it.
 */
export type WardicPressEvent = PointerEvent | KeyboardEvent | FocusEvent

/** A press's info (#427): a pointer's point less the scroll its hold counted into it, or a **Keyboard press**'s element's centre. */
export const pressInfoOf = (press: Recognizer.PressEvent, element: Element): WardicPressInfo => {
  if (press.input === "pointer") return { point: { x: press.event.x - press.event.scroll.x, y: press.event.y - press.event.scroll.y }, input: "pointer" }
  const box = element.getBoundingClientRect()
  return { point: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, input: "keyboard" }
}

/** A hover's or a press's info: its event's point less the scroll its hold counted into it. */
export const pointInfoOf = (event: InputSource.PointerLikeEvent): WardicPointInfo => ({
  point: { x: event.x - event.scroll.x, y: event.y - event.scroll.y },
})

/** What a drag's or a pan's sample carries for its info. */
type Sampled = Pick<Drag.Sample, "point" | "scroll" | "offset" | "delta" | "velocity">

/** A drag sample's info: its point less the scroll its hold counted into it, and its own offset, delta and velocity. */
export const dragInfoOf = (sample: Sampled): WardicDragInfo => ({
  point: { x: sample.point.x - sample.scroll.x, y: sample.point.y - sample.scroll.y },
  offset: sample.offset,
  delta: sample.delta,
  velocity: sample.velocity,
})

/** A sample's point alone, as a hover's or a press's info (a pan's session's start, #273). */
export const pointOfSample = (sample: Sampled): WardicPointInfo => ({
  point: { x: sample.point.x - sample.scroll.x, y: sample.point.y - sample.scroll.y },
})
