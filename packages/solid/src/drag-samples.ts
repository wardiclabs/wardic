/**
 * A `createDrag` sensor's samples (ADR-0019), Solid-free (#209): the core drag watch shaped by the
 * sensor's options, for both bindings' `createDrag` (#379).
 *
 * @module
 */
import * as Drag from "@wardic/core/Drag"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransformPoint } from "./config.ts"

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
 * Watch a drag's samples (#379): the core drag watch on `target` with `options`' axis and claim, each
 * sample kept within `bounds` when present (`Drag.within`, the off-axis zeroed before clamping), told
 * to `handlers.on` inside its pointer event, for both bindings' `createDrag`. Its points through
 * `mapPoint`, its nearest `WardicConfig`'s `transformPagePoint` read at each down (#443).
 */
export const watchDragSamples = (
  target: unknown,
  options: CreateDragOptions,
  handlers: InputFeed.Handlers<Drag.Sample>,
  mapPoint?: () => WardicTransformPoint | undefined,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
  const { axis = "xy", claim = true } = options
  const on = UndefinedOr.match(options.bounds, {
    onUndefined: () => handlers.on,
    onDefined: (bounds) => {
      const kept = Drag.within(bounds, UndefinedOr.map(options.elastic, (elastic) => ({ elastic })))
      return (sample: Drag.Sample) => handlers.on(kept(sample))
    },
  })
  return DragRecognizer.watchDrag(target, { axis, claim, mapPoint }, { ...handlers, on })
}
