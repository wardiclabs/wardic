/**
 * **Drag controls** (#431, CONTEXT.md; Motion's `useDragControls`), Solid-free: controls made apart
 * from any element and given to one or more, whose `start(event)` begins each one's drag from a
 * pointer that went down elsewhere, a handle or a track. Both bindings export {@link createDragControls};
 * each element's drag track subscribes while it's mounted.
 *
 * @module
 */
import * as Arr from "effect/Array"
import { constVoid } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"

/** `controls.start`'s options, as Motion's. */
export interface WardicDragControlsOptions {
  /** Moves the element so its centre is under the pointer as the drag begins, on the axes it drags. Default `false`. */
  readonly snapToCursor?: boolean | undefined
  /** How far the pointer moves, in pixels, before the drag starts. Default 3. */
  readonly distanceThreshold?: number | undefined
}

/**
 * `createDragControls()`'s controls: give them to elements as `dragControls`, then start, stop or
 * cancel their drags from anywhere.
 */
// #431, Motion's `DragControls`.
export interface WardicDragControls {
  /**
   * Starts a drag on each element given these controls, from `event`, a pointer pressed elsewhere: call
   * it from that pointer's `pointerdown`. Each follows the pointer as if it had been pressed itself,
   * once the pointer has moved past the threshold. Of two elements given the same controls on one axis,
   * only the first drags, unless the other has `dragPropagation`. One leaving an `<AnimatePresence>`
   * doesn't start. Give the handle `touch-action: none`, or a touch on it scrolls the page.
   */
  // Each takes its Drag claim as any drag does (Motion's drag lock).
  readonly start: (event: PointerEvent, options?: WardicDragControlsOptions) => void
  /** Ends each drag as letting go of the pointer would: it carries on as released, and `onDragEnd` (Solid 2: `dragEnd`) is called. */
  readonly stop: () => void
  /**
   * Ends each drag where it is: it doesn't carry on, `onDragEnd` isn't called, and `whileDrag` goes off.
   * A `layout` element goes back to its place, as after any drag.
   */
  readonly cancel: () => void
}

/** What an element's drag track gives the controls it's subscribed to. */
export interface ControlledDrag {
  readonly start: (event: PointerEvent, options: WardicDragControlsOptions) => void
  readonly stop: () => void
  readonly cancel: () => void
}

/** Each controls' subscribed tracks. */
const subscribed = new WeakMap<WardicDragControls, Set<ControlledDrag>>()

const NO_OPTIONS: WardicDragControlsOptions = {}

/**
 * Makes drag controls, which start an element's drag from somewhere else, such as a handle: give them
 * to each element they drive as `dragControls`, on a `w.*` element, in a ward's config or on a
 * `Reorder.Item`, and add `dragListener={false}` when a press on the element itself shouldn't drag it.
 * Needs no owner. Motion's `useDragControls`.
 *
 * @example
 * const controls = createDragControls()
 * <div onPointerDown={(e) => controls.start(e)} style={{ "touch-action": "none" }}>handle</div>
 * <w.div drag="x" dragControls={controls} dragListener={false} />
 * @see https://wardic.dev/reference/solid/gestures/create-drag-controls
 */
// #431: made outside the elements they drive; each element's drag track subscribes while it's mounted.
export const createDragControls = (): WardicDragControls => {
  const tracks = new Set<ControlledDrag>()
  // A track that subscribes or leaves while the controls call each is left out of that call.
  const each = (call: (track: ControlledDrag) => void): void => Arr.forEach(Arr.fromIterable(tracks), call)
  const controls: WardicDragControls = {
    start: (event, options = NO_OPTIONS) => each((track) => track.start(event, options)),
    stop: () => each((track) => track.stop()),
    cancel: () => each((track) => track.cancel()),
  }
  subscribed.set(controls, tracks)
  return controls
}

/** Subscribe a drag track to `controls` (internal): unsubscribed by the function it returns. Controls not made by {@link createDragControls} drive nothing. */
export const subscribeDragControls = (controls: WardicDragControls, track: ControlledDrag): (() => void) =>
  UndefinedOr.match(subscribed.get(controls), {
    onUndefined: () => constVoid,
    onDefined: (tracks) => {
      tracks.add(track)
      return () => {
        tracks.delete(track)
      }
    },
  })
