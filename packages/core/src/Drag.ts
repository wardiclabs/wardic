/**
 * A drag's samples and what shapes them: `Sample`, what `DragRecognizer`'s drags give at each step;
 * `Axis`, the axes one moves on; and the constraints a binding applies to a sample's `offset`, with a
 * rubber band past them (`constrain`, `within`, `withinBounds`), or to keep an element inside a
 * container (`boundsWithin`, `keepPlace` after a resize). A binding moves the element from the
 * shaped samples, and flings it at the end.
 *
 * @example
 * import * as Drag from "@wardic/core/Drag"
 *
 * const samples = DragRecognizer.drag(card, { axis: "x" }).pipe(
 *   Drag.withinBounds({ x: { min: 0, max: 200 } }, { elastic: 0.35 }),
 * )
 */
// #273 (element constraints); ADR-0019, *Amendment (#29)* (a drag kept to its axis); ADR-0004,
// *Amendment (#32)* (a binding composes the response, the Fling included).
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Stream from "effect/Stream"
import type * as Point from "./Point.ts"
import { dual } from "./internal/dual.ts"

/** One step of a drag, as `DragRecognizer`'s drags give it: where the pointer is, how far and how fast it's moved. */
// Effect-free and portable.
export interface Sample {
  /** Where the pointer is, in the Environment's coordinates. */
  readonly point: Point.Point
  /** How far it's moved since the down that started the drag: `point` less the down's. */
  readonly offset: Point.Point
  /** How far it's moved since the sample before. */
  readonly delta: Point.Point
  /**
   * The pointer's velocity on each axis, in units a second, over the drag's last 100 ms, as Motion's.
   * The `"end"` sample counts the release point, so a pause before letting go slows it, down to none.
   */
  readonly velocity: Point.Point
  /**
   * `"start"` once it's past its threshold, `"move"` as it moves, `"end"` at its release or a cancel. A
   * cancel ends at the last move's point, with the moves' velocity. A drag whose release was lost ends
   * at the pointer's first move with no button pressed, or at its next down: an `"end"` at the last
   * pressed point, with no delta and no velocity.
   */
  // A `pointercancel`'s own coordinates aren't the pointer's (Chromium's carries (0, 0)). The lost
  // release is a **Stale gesture** (ADR-0019).
  readonly phase: "start" | "move" | "end"
  /** The time, in ms, of the event behind it: for a move a scroll made, the scroll's. */
  readonly timeStamp: number
  /** The scroll counted into `point` since the down: `point` less `scroll` is where the pointer is on the screen. */
  // #257: the event's `InputSource.PointerLikeEvent.scroll`.
  readonly scroll: Point.Point
  /** The platform's own event behind it, which core never reads: a binding hands it to an app's callback. */
  // #273: `InputSource.PointerLikeEvent.raw`.
  readonly raw?: unknown
  /** The axes it moves on, read at its start: its drag's `axis`, or a direction-locked drag's lock. A pan's are both. */
  // #273.
  readonly axis: Axis
  /**
   * `true` on an `"end"` its watch's `cancel` gave: the drag ended where it is, which a binding
   * releases with no fling and tells no app. Absent on every other sample.
   */
  // #431, Motion's drag controls' `cancel`.
  readonly cancelled?: boolean
}

/** A range on one axis. Either end can be left out: `{ min: 0 }` holds it above 0, and lets it go as far as it likes the other way. */
export interface AxisRange {
  /** The least it goes to. */
  readonly min?: number
  /** The most it goes to. */
  readonly max?: number
}

/** A range on each axis. An axis left out is free. */
export interface Bounds {
  /** The range across. */
  readonly x?: AxisRange
  /** The range down. */
  readonly y?: AxisRange
}

/**
 * The axes a drag moves on: `"x"` or `"y"` alone, or `"xy"` for a free drag. A one-axis drag claims
 * only its axis, so a drag inside that moves on the other one keeps its own gesture.
 */
// A **Drag claim**, ADR-0019, *Amendment (#29)*.
export type Axis = "x" | "y" | "xy"

/** `v` past the range's `min`, pulled back toward it by `elastic`; `None` within it. */
const belowMin = (v: number, range: AxisRange, elastic: number): Option.Option<number> =>
  Option.fromNullishOr(range.min).pipe(
    Option.filter((min) => v < min),
    Option.map((min) => min - (min - v) * elastic),
  )

/** `v` past the range's `max`, pulled back toward it by `elastic`; `None` within it. */
const aboveMax = (v: number, range: AxisRange, elastic: number): Option.Option<number> =>
  Option.fromNullishOr(range.max).pipe(
    Option.filter((max) => v > max),
    Option.map((max) => max + (v - max) * elastic),
  )

/**
 * `v` kept within `range`, with `elastic` resistance past it, as Motion's `applyConstraints`: past an
 * end, only `elastic` of the overshoot is kept. So `elastic` 0 holds it at the end, 1 lets it go
 * freely, and between them it stretches like a rubber band. Within the range, or with no range, it's
 * `v`.
 *
 * @example
 * Drag.constrain(130, { min: 0, max: 100 }, 0.35) // 110.5
 */
// Below `min`: `min - (min - v) * elastic`; above `max`: `max + (v - max) * elastic`. Positional: a
// drag whose constraints bound the element's x/y applies it where the gesture's offset meets where the
// element started (ADR-0016, *Amendment (#140)*).
export const constrain = (v: number, range: AxisRange | undefined, elastic: number): number =>
  Option.fromUndefinedOr(range).pipe(
    Option.flatMap((r) => Option.orElse(belowMin(v, r, elastic), () => aboveMax(v, r, elastic))),
    Option.getOrElse(() => v),
  )

/** A box's edges, in its Environment's coordinates: a `Probe.Bounds` is one. */
export interface Edges {
  /** Its top edge. */
  readonly top: number
  /** Its right edge. */
  readonly right: number
  /** Its bottom edge. */
  readonly bottom: number
  /** Its left edge. */
  readonly left: number
}

/** One axis of {@link boundsWithin}: from the container's near edge less the box's, to its far edge less the box's; swapped when the box is bigger. */
const rangeWithin = (near: number, far: number, containerNear: number, containerFar: number): AxisRange => {
  const min = containerNear - near
  const max = containerFar - far
  if (containerFar - containerNear < far - near) return { min: max, max: min }
  return { min, max }
}

/**
 * The bounds on an element's x and y that keep its box inside `container`, as Motion's drag
 * constraints given an element. On an axis where the box is the bigger they turn around, so it can be
 * dragged to show what overflows and no further. `own` is the element's box with no x or y of its own:
 * its layout box.
 *
 * @example
 * const bounds = Drag.boundsWithin(cardBox, frameBox)
 */
// #273, ADR-0047: Motion's `calcViewportConstraints`. Per axis, from `container`'s near edge less
// `own`'s to its far edge less `own`'s; swapped when `own` is the bigger.
export const boundsWithin = (own: Edges, container: Edges): Bounds => ({
  x: rangeWithin(own.left, own.right, container.left, container.right),
  y: rangeWithin(own.top, own.bottom, container.top, container.bottom),
})

/** Whether two ranges are the same: each edge equal, or absent in both. */
const sameRange = (a: AxisRange | undefined, b: AxisRange | undefined): boolean =>
  UndefinedOr.match(a, {
    onUndefined: () => Predicate.isUndefined(b),
    onDefined: (ra) => UndefinedOr.match(b, { onUndefined: () => false, onDefined: (rb) => Bool.and(ra.min === rb.min, ra.max === rb.max) }),
  })

/** Whether two bounds are the same on both axes: a resize that changed neither leaves an element where it is. */
// #273.
export const sameBounds = (a: Bounds, b: Bounds): boolean => Bool.and(sameRange(a.x, b.x), sameRange(a.y, b.y))

/** Where `value` sits between `min` and `max`: 0 at `min`, 1 at `max`, held between; ½ for a range of no length. */
// Motion's `calcOrigin` for a point.
export const progressWithin = (value: number, min: number, max: number): number => {
  if (max === min) return 0.5
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

/** A range's two edges, when it has both. */
const edgesOfRange = (range: AxisRange | undefined): Option.Option<readonly [number, number]> =>
  Option.fromUndefinedOr(range).pipe(Option.flatMap((r) => Option.all([Option.fromUndefinedOr(r.min), Option.fromUndefinedOr(r.max)] as const)))

/** One axis of {@link keepPlace}: `value` at its place in `from`, within `to`, if both have both edges. */
const keptOn = (value: number, from: AxisRange | undefined, to: AxisRange | undefined): number =>
  Option.match(Option.all([edgesOfRange(from), edgesOfRange(to)] as const), {
    onNone: () => value,
    onSome: ([[fromMin, fromMax], [toMin, toMax]]) => toMin + progressWithin(value, fromMin, fromMax) * (toMax - toMin),
  })

/**
 * `position` moved to keep its place, from `from` within `to`: an element's x and y after a resize
 * changes the bounds that keep it inside its container, as Motion's. Only on the axes `axis` moves,
 * and where both bounds have both ends; elsewhere it stays.
 */
// #273: Motion's `scalePositionWithinConstraints`.
export const keepPlace = (position: Point.Point, axis: Axis, from: Bounds, to: Bounds): Point.Point => ({
  x: Bool.match(axis === "y", { onTrue: () => position.x, onFalse: () => keptOn(position.x, from.x, to.x) }),
  y: Bool.match(axis === "x", { onTrue: () => position.y, onFalse: () => keptOn(position.y, from.y, to.y) }),
})

/**
 * `sample` with its `offset` kept within `bounds`, as `constrain` keeps a number: `elastic` 0, a hard
 * stop, unless it's given. An axis left out is free; `delta` and `velocity` stay the pointer's. For
 * samples one at a time, as a watch's handler has them; `withinBounds` shapes a Stream's.
 *
 * @example
 * const shaped = Drag.within(sample, { x: { min: 0, max: 200 } }, { elastic: 0.35 })
 */
// `dual`, the sample first (#379).
export const within: {
  (bounds: Bounds, options?: { readonly elastic?: number }): (sample: Sample) => Sample
  (sample: Sample, bounds: Bounds, options?: { readonly elastic?: number }): Sample
} = dual(
  (first) => Predicate.hasProperty(first, "phase"),
  (sample: Sample, bounds: Bounds, options: { readonly elastic?: number } = {}): Sample => {
    const elastic = Option.getOrElse(Option.fromNullishOr(options.elastic), () => 0)
    return {
      ...sample,
      offset: {
        x: constrain(sample.offset.x, bounds.x, elastic),
        y: constrain(sample.offset.y, bounds.y, elastic),
      },
    }
  },
)

/**
 * A drag's samples with each one's `offset` kept within `bounds`, as `within` keeps one: for a Stream of
 * them. `delta` and `velocity` stay the pointer's: a binding places the element from `offset`, and the
 * others stay a true record of how the pointer moved.
 *
 * @example
 * DragRecognizer.drag(card).pipe(Drag.withinBounds({ x: { min: 0, max: 200 } }, { elastic: 0.5 }))
 */
// A `Stream.map` of `within`, `dual`, the stream first, keeping the stream's `E` and `R`: pure and
// stateless (clamping `delta` and `velocity` too would need the prior sample). Probe-free per ADR-0004:
// the numeric form, not the element-relative one.
export const withinBounds: {
  (
    bounds: Bounds,
    options?: { readonly elastic?: number },
  ): <E, R>(stream: Stream.Stream<Sample, E, R>) => Stream.Stream<Sample, E, R>
  <E, R>(
    stream: Stream.Stream<Sample, E, R>,
    bounds: Bounds,
    options?: { readonly elastic?: number },
  ): Stream.Stream<Sample, E, R>
} = dual(
  Stream.isStream,
  <E, R>(
    stream: Stream.Stream<Sample, E, R>,
    bounds: Bounds,
    options: { readonly elastic?: number } = {},
  ): Stream.Stream<Sample, E, R> => Stream.map(stream, (sample) => within(sample, bounds, options)),
)
