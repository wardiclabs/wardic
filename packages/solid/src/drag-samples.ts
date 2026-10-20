/**
 * A `createDrag` sensor's samples (ADR-0019), Solid-free (#209): the core `drag` recognizer shaped by
 * the sensor's options, for both bindings' `createDrag`.
 *
 * @module
 */
import * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import type * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"

/** The axis, claim and bounds options for {@link createDrag}. */
export interface CreateDragOptions {
  /** Keep the drag to a single axis, zeroing the off-axis components; it claims only that axis. */
  readonly axis?: "x" | "y"
  /**
   * `false`: take no **Drag claim** (ADR-0019, *Amendment (#29)*), so watching a pan over an area
   * blocks no draggable inside it, and a draggable inside it blocks nothing here. Default `true`.
   */
  readonly claim?: boolean
  /** Constrain `offset` to a static numeric region (optionally elastic). */
  readonly bounds?: Drag.Bounds
  /** Rubber-band resistance past `bounds` (0 = hard clamp, 1 = free). */
  readonly elastic?: number
}

/**
 * A drag's samples: the core `drag` recognizer on `target` with `options`' axis and claim, then `withinBounds`
 * when `bounds` is present (the off-axis is zeroed before clamping), keeping the requirement
 * set (`InputSource`) untouched.
 */
export const dragSamples = (target: unknown, options: CreateDragOptions = {}): Stream.Stream<Drag.Sample, never, InputSource.InputSource> => {
  const { axis = "xy", claim = true } = options
  const recognized = Recognizer.drag(target, { axis, claim })
  return UndefinedOr.match(options.bounds, {
    onUndefined: () => recognized,
    onDefined: (bounds) =>
      recognized.pipe(
        Drag.withinBounds(bounds, UndefinedOr.map(options.elastic, (elastic) => ({ elastic }))),
      ),
  })
}
