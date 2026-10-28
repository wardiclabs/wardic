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

/** {@link WardicDragControls.start}'s options (Motion's). */
export interface WardicDragControlsOptions {
  /**
   * Move the element so its centre is under the pointer as the drag begins (Motion's `snapToCursor`):
   * measured from its box, on the axes it drags. Default `false`.
   */
  readonly snapToCursor?: boolean | undefined
  /** How far (px) the pointer moves before the drag starts (Motion's `distanceThreshold`). Default 3. */
  readonly distanceThreshold?: number | undefined
}

/**
 * Drag controls (#431, Motion's `DragControls`): give them to elements with `dragControls={controls}`,
 * then start their drags from anywhere.
 */
export interface WardicDragControls {
  /**
   * Begin a drag on each element given these controls, from `event`, a pointer pressed elsewhere
   * (call it from that pointer's `pointerdown`): it follows the pointer as if it had pressed the
   * element, past the threshold. Each takes its **Drag claim** as any drag does, so of two given the
   * same controls on one axis only the first drags, unless the other has `dragPropagation` (Motion's
   * drag lock). An element leaving an `<AnimatePresence>` starts none. The handle wants
   * `touch-action: none`, or a touch on it scrolls the page.
   */
  readonly start: (event: PointerEvent, options?: WardicDragControlsOptions) => void
  /** End each drag as its pointer's release would: its release runs, and `onDragEnd` (Solid 2's `dragEnd`) is told. */
  readonly stop: () => void
  /**
   * End each drag where it is: no release and no `onDragEnd`, `whileDrag` off, its claim given back.
   * A layout node goes back to its slot, at rest, as its drag always does.
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
 * Make **Drag controls** (#431, Motion's `useDragControls`): made outside the elements they drive, and
 * given to each as `dragControls` (on a `wardic.*` element, in a ward's config, or on a `Reorder.Item`),
 * with `dragListener={false}` when the element's own presses shouldn't drag it. Needs no owner.
 *
 * @example
 * const controls = createDragControls()
 * <div onPointerDown={(e) => controls.start(e)} style={{ "touch-action": "none" }}>handle</div>
 * <wardic.div drag="x" dragControls={controls} dragListener={false} />
 */
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
