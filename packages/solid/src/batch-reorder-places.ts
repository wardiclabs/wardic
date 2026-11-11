/**
 * A **Batch Reorder group**'s places (#712, ADR-0072 decisions 3 and 4), Solid-free and DOM-free but for
 * the style strings: where each item goes, from its index, and how the group and its items are styled.
 *
 * - **Places**: every item is one size; `axis` picks the shape, a column (`"y"`), a row (`"x"`) or a wrapping
 *   grid (`"xy"`), `gap` apart; a grid's `columns`, else as many as the group's width holds (Q36).
 * - **The items' origin is their static position**: each item is `position: absolute` with no `top` or
 *   `left`, so it sits where it would in flow, at the start of the group's content box, its padding kept;
 *   right to left, at its right edge, the places going leftward from there (Q35).
 * - **A grid whose width isn't read yet** (a server's, Q37; a client's until its first read) is laid out by
 *   CSS grid, each item in flow, at the same places.
 *
 * @module
 */
import type * as CoreReorder from "@wardic/core/Reorder"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import { identity } from "effect/Function"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { fail } from "./batch.ts"

/** Every item's size in a Batch Reorder group, in px. */
export interface ReorderBatchItemSize {
  readonly width: number
  readonly height: number
}

/** A point, or a length on each axis, in px. */
export interface XY {
  readonly x: number
  readonly y: number
}

/** The space between a Batch Reorder group's places, in px: one for both axes, or each its own. */
export type ReorderBatchGap = number | XY

/** A group's direction: its places from its content box's left, or, right to left, from its right. */
export type BatchReorderDirection = "ltr" | "rtl"

/** What the group reads of its element once it's on the page (Q35, Q36): the direction it inherits, and its content box's width. */
export interface BatchReorderRead {
  readonly direction: BatchReorderDirection
  /** Its content width, read for a grid whose columns come from it; `undefined` for any other. */
  readonly width: number | undefined
}

/** Whether two reads of a group's element are alike: the same direction and width. */
export const sameRead = (a: BatchReorderRead | undefined, b: BatchReorderRead | undefined): boolean =>
  UndefinedOr.match(a, {
    onUndefined: () => Predicate.isUndefined(b),
    onDefined: (x) => UndefinedOr.match(b, { onUndefined: () => false, onDefined: (y) => Bool.and(x.direction === y.direction, x.width === y.width) }),
  })

/**
 * Where a Batch Reorder group's items go (decision 3): its shape, its items' size, the gap, a grid's
 * columns, its direction, and its content width once it's read.
 */
export interface BatchReorderGeometry {
  readonly axis: CoreReorder.Axis
  readonly itemSize: ReorderBatchItemSize
  readonly gap: ReorderBatchGap | undefined
  readonly columns: number | undefined
  readonly direction: BatchReorderDirection
  readonly width: number | undefined
}

/** What a group's props give its geometry, as either binding reads them. */
export interface BatchReorderProps {
  readonly axis?: CoreReorder.Axis | undefined
  readonly itemSize: ReorderBatchItemSize
  readonly gap?: ReorderBatchGap | undefined
  readonly columns?: number | undefined
  readonly direction?: BatchReorderDirection | undefined
  readonly style?: unknown
}

/** A style's own `direction`, when it gives one: an app's on the group. */
const styleDirectionOf = (style: unknown): BatchReorderDirection | undefined => {
  if (!Predicate.isObject(style)) return undefined
  const given = (style as Readonly<Record<string, unknown>>).direction
  return Bool.match(Bool.or(given === "rtl", given === "ltr"), { onTrue: () => given as BatchReorderDirection, onFalse: () => undefined })
}

/**
 * A group's geometry from its props and what it read of its element (Q35): its axis `"y"` when it gives none;
 * its direction its `direction`, else its own `style`'s, else the one its element inherits, read as it
 * mounts, else `"ltr"` (a server's, and a client's before its first read).
 */
export const geometryOf = (props: BatchReorderProps, read: BatchReorderRead | undefined): BatchReorderGeometry => ({
  axis: UndefinedOr.match(props.axis, { onUndefined: (): CoreReorder.Axis => "y", onDefined: identity }),
  itemSize: props.itemSize,
  gap: props.gap,
  columns: props.columns,
  direction: UndefinedOr.match(props.direction, {
    onUndefined: () =>
      UndefinedOr.match(styleDirectionOf(props.style), {
        onUndefined: () => UndefinedOr.match(read, { onUndefined: (): BatchReorderDirection => "ltr", onDefined: (r) => r.direction }),
        onDefined: identity,
      }),
    onDefined: identity,
  }),
  width: UndefinedOr.match(read, { onUndefined: () => undefined, onDefined: (r) => r.width }),
})

/**
 * A group's places, resolved from its geometry once a change: how many a row holds, the step from one to
 * the next on each axis, which way the columns go (right to left, leftward from the right edge), every
 * item's size, and the group's width.
 */
export interface BatchReorderPlaces {
  readonly columns: number
  readonly stepX: number
  readonly stepY: number
  readonly signX: number
  readonly itemSize: ReorderBatchItemSize
  /** The group's width: its places', or, its columns from its width (Q36), its own. */
  readonly width: number
  /** Whether its columns come from its width: the group sets no width of its own. */
  readonly fromWidth: boolean
}

const ORIGIN: XY = { x: 0, y: 0 }
const NO_SIZE: ReorderBatchItemSize = { width: 0, height: 0 }

/** A gap's two axes: one number for both, else each its own. Built once, at module load. */
const gapsOf: (gap: ReorderBatchGap) => XY = Match.type<ReorderBatchGap>().pipe(
  Match.when(Predicate.isNumber, (gap): XY => ({ x: gap, y: gap })),
  Match.orElse((gap) => gap as XY),
)

/** Whether a grid's `columns` is a whole number, 1 or more. */
const isColumnCount = (columns: number): boolean => Bool.and(Number.isInteger(columns), columns >= 1)

/** A grid's given `columns`, checked. */
const checkedColumns = (columns: number): number =>
  Bool.match(isColumnCount(columns), {
    onTrue: () => columns,
    onFalse: () => fail(`a Reorder.BatchGroup's \`columns\` is ${String(columns)}: a whole number, 1 or more`),
  })

/** How many places of `step` fit `width`, a `gap` after all but the last: at least one; one before the width is read. */
const columnsFitting = (width: number | undefined, step: number, gap: number): number =>
  UndefinedOr.match(width, { onUndefined: () => 1, onDefined: (w) => Math.max(1, Math.floor((w + gap) / step)) })

/** How many places a row holds, by axis: one in a column, every item in a row, a grid's `columns`, else as many as its width holds (Q36). */
const columnsBy: (axis: CoreReorder.Axis) => (geometry: BatchReorderGeometry, n: number, step: number, gap: number) => number = Match.type<CoreReorder.Axis>().pipe(
  Match.when("y", () => (): number => 1),
  Match.when("x", () => (_: BatchReorderGeometry, n: number): number => Math.max(n, 1)),
  Match.orElse(() => (geometry: BatchReorderGeometry, _: number, step: number, gap: number): number =>
    UndefinedOr.match(geometry.columns, { onUndefined: () => columnsFitting(geometry.width, step, gap), onDefined: checkedColumns })
  ),
)

/** A grid whose columns come from its width: `"xy"` with no `columns`. */
export const isFromWidth = (geometry: BatchReorderGeometry): boolean => Bool.and(geometry.axis === "xy", Predicate.isUndefined(geometry.columns))

/** Whether a group's items are laid out in flow by CSS grid: its columns from a width it hasn't read. */
export const inGridFlow = (geometry: BatchReorderGeometry): boolean => Bool.and(isFromWidth(geometry), Predicate.isUndefined(geometry.width))

/** Each direction's way along a row: rightward, or leftward from the right edge. */
const SIGN_X: Readonly<Record<BatchReorderDirection, number>> = { ltr: 1, rtl: -1 }

/** `geometry`'s places for `n` items: an error naming a grid's `columns` that isn't a whole number. */
export const resolvePlaces = (geometry: BatchReorderGeometry, n: number): BatchReorderPlaces => {
  const gap = UndefinedOr.match(geometry.gap, { onUndefined: () => ORIGIN, onDefined: gapsOf })
  const stepX = geometry.itemSize.width + gap.x
  const columns = columnsBy(geometry.axis)(geometry, n, stepX, gap.x)
  const fromWidth = isFromWidth(geometry)
  const used = Math.min(columns, Math.max(n, 1))
  const placesWidth = Bool.match(n === 0, { onTrue: () => 0, onFalse: () => (used - 1) * stepX + geometry.itemSize.width })
  return {
    columns,
    stepX,
    stepY: geometry.itemSize.height + gap.y,
    signX: SIGN_X[geometry.direction],
    itemSize: geometry.itemSize,
    width: Bool.match(fromWidth, { onTrue: () => UndefinedOr.match(geometry.width, { onUndefined: () => placesWidth, onDefined: identity }), onFalse: () => placesWidth }),
    fromWidth,
  }
}

/** Whether two resolutions place every item alike. */
export const samePlaces = (a: BatchReorderPlaces, b: BatchReorderPlaces): boolean =>
  Bool.every([a.columns === b.columns, a.stepX === b.stepX, a.stepY === b.stepY, a.signX === b.signX])

/** Item `i`'s place among `places`: its column and row, a step apart, from its static position. */
export const placeOf = (places: BatchReorderPlaces, i: number): XY => ({
  x: places.signX * (i % places.columns) * places.stepX,
  y: Math.floor(i / places.columns) * places.stepY,
})

/** The group's size for `n` items: its width, and its places' height, the last row's far edge. */
export const extentOf = (places: BatchReorderPlaces, n: number): ReorderBatchItemSize =>
  Bool.match(n === 0, {
    onTrue: () => NO_SIZE,
    onFalse: () => ({ width: places.width, height: (Math.ceil(n / places.columns) - 1) * places.stepY + places.itemSize.height }),
  })

/** `px`. */
export const px = (n: number): string => `${n}px`

/**
 * The group element's style for `places`, `geometry` and `n` items, under `own`: positioned, its direction,
 * and sized to its places, or, a grid whose width isn't read yet, laid out by CSS grid (Q37), the same on
 * the server and the client, so hydrating keeps the markup.
 */
export const groupStyleOf = (places: BatchReorderPlaces, n: number, geometry: BatchReorderGeometry, own: Style.Input): Style.Style => {
  const base = { ...ReorderController.GROUP_STYLE, position: "relative", direction: geometry.direction }
  const sized: Readonly<Record<string, string>> = Bool.match(inGridFlow(geometry), {
    onTrue: () => ({
      ...base,
      display: "grid",
      "grid-template-columns": `repeat(auto-fill, ${px(places.itemSize.width)})`,
      "column-gap": px(places.stepX - places.itemSize.width),
      "row-gap": px(places.stepY - places.itemSize.height),
    }),
    onFalse: () => {
      const extent = extentOf(places, n)
      // Its columns from its width (Q36): its width is the app's, which it reads.
      return Bool.match(places.fromWidth, {
        onTrue: () => ({ ...base, height: px(extent.height) }),
        onFalse: () => ({ ...base, width: px(extent.width), height: px(extent.height) }),
      })
    },
  })
  return Style.over(own, sized)
}

/** A Reorder item's drag axis for its group's: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

/**
 * An item's own style under its group's: sized, a drag element's defaults, and, unless its group lays it
 * out in flow, absolute at its static position (no `top` or `left`): the start of the group's content box.
 */
export const itemBaseOf = (geometry: BatchReorderGeometry): Readonly<Record<string, string>> => {
  const base = { ...Style.dragDefaults(dragAxisFor(geometry.axis)), width: px(geometry.itemSize.width), height: px(geometry.itemSize.height) }
  return Bool.match(inGridFlow(geometry), { onTrue: () => base, onFalse: () => ({ ...base, position: "absolute" }) })
}

/**
 * A style as CSS text: the one every item of a group shares, written once as each is made, where a key at
 * a time cost each item a write per key (#712, Q47).
 */
export const cssTextOf = (style: Style.Style): string => Arr.join(Arr.map(Rec.toEntries(style), ([key, value]) => `${key}:${String(value)}`), ";")

/** Whether two styles have the same keys, each at the same value. */
export const sameStyle: Equivalence.Equivalence<Style.Style> = Rec.makeEquivalence(Equivalence.strictEqual<unknown>())
