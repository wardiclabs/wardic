/**
 * A **Batch Reorder group**'s places (#712, ADR-0072 decisions 3 and 4), Solid-free and DOM-free but for
 * the style strings: where each item goes, from its index, and how the group and its items are styled.
 *
 * - **Places**: `axis` picks the shape, a column (`"y"`), a row (`"x"`) or a wrapping grid (`"xy"`), `gap`
 *   apart. Every item one size: a grid's `columns`, else as many as the group's width holds (Q36). Each its
 *   own size, a function's (#714, *Amendment (#714)*): each place after the sizes before it, a grid's rows
 *   breaking where the next item doesn't fit the group's width, each item at its row's top.
 * - **A column's items may take the group's content width** (#714, Q10), by CSS: the group a size container,
 *   each such item `100cqi` wide, exact on the server too, with nothing read.
 * - **The items' origin is their static position**: each item is `position: absolute` with no `top` or
 *   `left`, so it sits where it would in flow, at the start of the group's content box, its padding kept;
 *   right to left, at its right edge, the places going leftward from there (Q35).
 * - **A grid whose width isn't read yet** (a server's, Q37; a client's until its first read) is laid out by
 *   CSS, each item in flow, at the same places: CSS grid for one size, `flex-wrap` for each its own (#714, Q5).
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
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { fail } from "./batch.ts"

/** An item's size in a Batch Reorder group, in px. */
export interface ReorderBatchItemSize {
  readonly width: number
  readonly height: number
}

/**
 * An item's size in a column (`axis="y"`), in px: its height, and its width, or, left out, the group's
 * content width, padding and border inside it (#714, Q10).
 */
export interface ReorderBatchColumnSize {
  readonly width?: number | undefined
  readonly height: number
}

/**
 * A group's shape and its items' sizes (#714, ADR-0072 *Amendment (#714)*): one size for every item, or
 * a function giving each item's. In a column (`"y"`, the default) a size may leave out `width`: the item
 * takes the group's content width. `columns` goes only with one size: a function's rows break at the
 * group's width (Q9).
 */
export type ReorderBatchSizing<V> =
  | {
    /** The list's shape: `"y"`, a column (the default), `"x"`, a row, or `"xy"`, a grid that wraps. */
    readonly axis?: CoreReorder.Axis | undefined
    /**
     * Every item's size, in px, or a function giving each item's from it and its index, called for every
     * item at each change of the list and tracked: what it reads places every item again. In a column,
     * `width` left out is the group's content width.
     */
    readonly itemSize: ReorderBatchItemSize
    /** A grid's columns: how many items a row holds. Left out, as many as the group's width holds, read again as it's resized. */
    readonly columns?: number | undefined
  }
  | {
    readonly axis?: "y" | undefined
    readonly itemSize: ReorderBatchColumnSize
    readonly columns?: number | undefined
  }
  | {
    readonly axis?: CoreReorder.Axis | undefined
    readonly itemSize: (item: V, i: number) => ReorderBatchItemSize
    /** Only with one size: a function's rows break at the group's width. */
    readonly columns?: undefined
  }
  | {
    readonly axis?: "y" | undefined
    readonly itemSize: (item: V, i: number) => ReorderBatchColumnSize
    readonly columns?: undefined
  }

/** A group's `itemSize` as its places read it, whatever its shape: one size, or a function of each item. */
export type BatchReorderItemSizes = ReorderBatchColumnSize | ((item: never, i: number) => ReorderBatchColumnSize)

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
  /**
   * Its content width, read where its places come from it, a grid with no `columns`, of one size or each
   * its own (#714); `undefined` for any other.
   */
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
  readonly itemSize: BatchReorderItemSizes
  readonly gap: ReorderBatchGap | undefined
  readonly columns: number | undefined
  readonly direction: BatchReorderDirection
  readonly width: number | undefined
}

/** What a group's props give its geometry, as either binding reads them. */
export interface BatchReorderProps {
  readonly axis?: CoreReorder.Axis | undefined
  readonly itemSize: BatchReorderItemSizes
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
 * item's size, and the group's width; or, its items each their own size, each one's place and size.
 */
export interface BatchReorderPlaces {
  readonly columns: number
  readonly stepX: number
  readonly stepY: number
  readonly signX: number
  /** Every item's size; `NO_SIZE` when each is its own (`each`). */
  readonly itemSize: ReorderBatchItemSize
  /** The group's width: its places', or, its width the app's, what it read of it (0 before). */
  readonly width: number
  /** Whether its width is the app's (its columns or its rows from its width, Q36; a column of its width, #714): it sets none. */
  readonly appsWidth: boolean
  /** Whether any item takes the group's content width (#714, Q10): the group is a size container for their width. */
  readonly takesWidth: boolean
  /** Each item's place and size, its items each their own size (#714); `undefined` when they're one. */
  readonly each: ItemPlaces | undefined
}

/** Each item's place, from the start of the group's content box, and its size, in the list's order (#714). */
export interface ItemPlaces {
  readonly xs: Float64Array
  readonly ys: Float64Array
  /** Each one's width: `NaN` for one that takes the group's content width (Q10). */
  readonly widths: Float64Array
  readonly heights: Float64Array
  /** The group's size: its places' far edges. */
  readonly width: number
  readonly height: number
}

const ORIGIN: XY = { x: 0, y: 0 }
const NO_SIZE: ReorderBatchItemSize = { width: 0, height: 0 }

/** A gap's two axes: one number for both, else each its own. Built once, at module load. */
const gapsOf: (gap: ReorderBatchGap) => XY = Match.type<ReorderBatchGap>().pipe(
  Match.when(Predicate.isNumber, (gap): XY => ({ x: gap, y: gap })),
  Match.orElse((gap) => gap as XY),
)

/** A geometry's gap on each axis: none when it gives none. */
const gapOf = (geometry: BatchReorderGeometry): XY => UndefinedOr.match(geometry.gap, { onUndefined: () => ORIGIN, onDefined: gapsOf })

/** The content width a group read of its element: 0 before it's read (a server's, a client's before its first read). */
const readWidthOf = (geometry: BatchReorderGeometry): number => UndefinedOr.match(geometry.width, { onUndefined: () => 0, onDefined: identity })

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

/** A grid whose rows break at its width: `"xy"` with no `columns`, its items one size (Q36) or each their own (#714). */
export const isFromWidth = (geometry: BatchReorderGeometry): boolean => Bool.and(geometry.axis === "xy", Predicate.isUndefined(geometry.columns))

/** Whether a group's items are laid out in flow by CSS: its rows from a width it hasn't read. */
export const inGridFlow = (geometry: BatchReorderGeometry): boolean => Bool.and(isFromWidth(geometry), Predicate.isUndefined(geometry.width))

/** Each direction's way along a row: rightward, or leftward from the right edge. */
const SIGN_X: Readonly<Record<BatchReorderDirection, number>> = { ltr: 1, rtl: -1 }

/** A function `itemSize` as the places call it. */
type SizeOf = (item: unknown, i: number) => ReorderBatchColumnSize

/**
 * `geometry`'s places for `values`: every item one size, or each its own, a function's (#714). An error
 * names a grid's `columns` that isn't a whole number.
 */
export const resolvePlaces = (geometry: BatchReorderGeometry, values: ReadonlyArray<unknown>): BatchReorderPlaces =>
  Bool.match(Predicate.isFunction(geometry.itemSize), {
    onTrue: () => resolveEach(geometry, values, geometry.itemSize as SizeOf),
    onFalse: () => resolveOne(geometry, values.length, geometry.itemSize as ReorderBatchColumnSize),
  })

/** Places for `n` items of one size, a column's width the group's when it gives none (#714, Q10): never read, 0 here. */
const resolveOne = (geometry: BatchReorderGeometry, n: number, size: ReorderBatchColumnSize): BatchReorderPlaces => {
  const gap = gapOf(geometry)
  const takesWidth = Predicate.isUndefined(size.width)
  const itemSize: ReorderBatchItemSize = { width: UndefinedOr.match(size.width, { onUndefined: () => readWidthOf(geometry), onDefined: identity }), height: size.height }
  const stepX = itemSize.width + gap.x
  const columns = columnsBy(geometry.axis)(geometry, n, stepX, gap.x)
  const appsWidth = Bool.or(isFromWidth(geometry), takesWidth)
  const used = Math.min(columns, Math.max(n, 1))
  const placesWidth = Bool.match(n === 0, { onTrue: () => 0, onFalse: () => (used - 1) * stepX + itemSize.width })
  return {
    columns,
    stepX,
    stepY: itemSize.height + gap.y,
    signX: SIGN_X[geometry.direction],
    itemSize,
    width: Bool.match(appsWidth, { onTrue: () => UndefinedOr.match(geometry.width, { onUndefined: () => placesWidth, onDefined: identity }), onFalse: () => placesWidth }),
    appsWidth,
    takesWidth,
    each: undefined,
  }
}

/** Places for `values`, each its own size, `sizeOf`'s (#714): laid out by the group's axis. */
const resolveEach = (geometry: BatchReorderGeometry, values: ReadonlyArray<unknown>, sizeOf: SizeOf): BatchReorderPlaces => {
  const widths = new Float64Array(values.length)
  const heights = new Float64Array(values.length)
  let takesWidth = false
  // Per item at a change: statements.
  Arr.forEach(values, (item, i) => {
    const size = sizeOf(item, i)
    heights[i] = size.height
    if (Predicate.isNotUndefined(size.width)) {
      widths[i] = size.width
      return
    }
    widths[i] = Number.NaN
    takesWidth = true
  })
  const each = layoutBy(geometry.axis)(widths, heights, gapOf(geometry), geometry.width)
  const appsWidth = Bool.or(isFromWidth(geometry), takesWidth)
  return {
    columns: 1,
    stepX: 0,
    stepY: 0,
    signX: SIGN_X[geometry.direction],
    itemSize: NO_SIZE,
    width: Bool.match(appsWidth, { onTrue: () => readWidthOf(geometry), onFalse: () => each.width }),
    appsWidth,
    takesWidth,
    each,
  }
}

/** A layout of items each their own size: their places from their sizes, the gap and the group's content width. */
type EachLayout = (widths: Float64Array, heights: Float64Array, gap: XY, width: number | undefined) => ItemPlaces

/** A column: each item below the one before, a gap apart; as wide as the widest, those that take the group's width aside. */
const columnLayout: EachLayout = (widths, heights, gap) => {
  const ys = new Float64Array(heights.length)
  let y = 0
  let width = 0
  // Per item at a change: statements.
  Iter.forEach(heights, (height, i) => {
    ys[i] = y
    y = y + height + gap.y
    if (widths[i] > width) width = widths[i]
  })
  return { xs: new Float64Array(heights.length), ys, widths, heights, width, height: Math.max(0, y - gap.y) }
}

/** A row: each item after the one before, a gap apart, at the row's top; as tall as the tallest. */
const rowLayout: EachLayout = (widths, heights, gap) => {
  const xs = new Float64Array(widths.length)
  let x = 0
  let height = 0
  // Per item at a change: statements.
  Iter.forEach(widths, (width, i) => {
    xs[i] = x
    x = x + width + gap.x
    if (heights[i] > height) height = heights[i]
  })
  return { xs, ys: new Float64Array(widths.length), widths, heights, width: Math.max(0, x - gap.x), height }
}

/** How far past the group's width an item may reach and still fit its row: a hundredth of a px, for sums that round. */
const FIT_SLACK = 0.01

/**
 * Rows, as CSS `flex-wrap` with `align-items: flex-start` (Q2): items left to right while they fit the
 * group's content width, the next row below the tallest of the one before, each item at its row's top.
 * Before the width is read, every item at no place: in flow, where `flex-wrap` has it (Q5).
 */
const rowsLayout: EachLayout = (widths, heights, gap, width) => {
  const n = widths.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  if (Predicate.isUndefined(width)) return { xs, ys, widths, heights, width: 0, height: 0 }
  let x = 0
  let rowY = 0
  let rowHeight = 0
  let widest = 0
  // Per item at a change: statements.
  Iter.forEach(widths, (itemWidth, i) => {
    if (x > 0 && x + itemWidth - width > FIT_SLACK) {
      rowY = rowY + rowHeight + gap.y
      x = 0
      rowHeight = 0
    }
    xs[i] = x
    ys[i] = rowY
    x = x + itemWidth + gap.x
    if (x - gap.x > widest) widest = x - gap.x
    if (heights[i] > rowHeight) rowHeight = heights[i]
  })
  return { xs, ys, widths, heights, width: widest, height: rowY + rowHeight }
}

/** Each axis's layout of items each their own size. Built once, at module load. */
const layoutBy: (axis: CoreReorder.Axis) => EachLayout = Match.type<CoreReorder.Axis>().pipe(
  Match.when("y", () => columnLayout),
  Match.when("x", () => rowLayout),
  Match.orElse(() => rowsLayout),
)

/** Whether two arrays of numbers hold the same numbers in the same order. */
const sameNumbers = (a: Float64Array, b: Float64Array): boolean => {
  if (a.length !== b.length) return false
  return Bool.not(Iter.some(a, (x, i) => x !== b[i]))
}

/** Whether two resolutions of items each their own size place every item alike. */
const sameEach = (a: ItemPlaces | undefined, b: ItemPlaces | undefined): boolean => {
  if (Predicate.isUndefined(a)) return Predicate.isUndefined(b)
  if (Predicate.isUndefined(b)) return false
  if (Bool.not(sameNumbers(a.xs, b.xs))) return false
  return sameNumbers(a.ys, b.ys)
}

/** Whether two resolutions place every item alike. */
export const samePlaces = (a: BatchReorderPlaces, b: BatchReorderPlaces): boolean => {
  if (Bool.not(Bool.every([a.columns === b.columns, a.stepX === b.stepX, a.stepY === b.stepY, a.signX === b.signX]))) return false
  return sameEach(a.each, b.each)
}

/** Item `i`'s place among `places`: its column and row, a step apart, or its own (#714), from its static position. */
export const placeOf = (places: BatchReorderPlaces, i: number): XY => {
  // Per item at a change: statements.
  const each = places.each
  if (Predicate.isNotUndefined(each)) return { x: places.signX * each.xs[i], y: each.ys[i] }
  return { x: places.signX * (i % places.columns) * places.stepX, y: Math.floor(i / places.columns) * places.stepY }
}

/**
 * Item `i`'s width among `places`: one taking the group's content width has none, its width the group's by
 * CSS and never read (#714): a column's crossover reads its places' `y` alone.
 */
export const widthAt = (places: BatchReorderPlaces, i: number): number => {
  // Per item, per drag sample: statements.
  const each = places.each
  if (Predicate.isUndefined(each)) return places.itemSize.width
  const width = each.widths[i]
  if (Number.isNaN(width)) return places.width
  return width
}

/** Item `i`'s height among `places`. */
export const heightAt = (places: BatchReorderPlaces, i: number): number => {
  // Per item, per drag sample: statements.
  const each = places.each
  if (Predicate.isUndefined(each)) return places.itemSize.height
  return each.heights[i]
}

/** The group's size for `n` items: its width, and its places' height, the last row's far edge. */
export const extentOf = (places: BatchReorderPlaces, n: number): ReorderBatchItemSize =>
  Bool.match(n === 0, {
    onTrue: () => NO_SIZE,
    onFalse: () =>
      UndefinedOr.match(places.each, {
        onUndefined: () => ({ width: places.width, height: (Math.ceil(n / places.columns) - 1) * places.stepY + places.itemSize.height }),
        onDefined: (each) => ({ width: places.width, height: each.height }),
      }),
  })

/** `px`. */
export const px = (n: number): string => `${n}px`

/**
 * The width of an item that takes the group's content width (#714, Q10): all of its query container's
 * inline size, which is its content box's, the group being one ({@link SIZE_CONTAINER}).
 */
const GROUP_WIDTH = "100cqi"

/** What an item that takes the group's content width is styled with: that width, its padding and border inside it. */
const TAKES_GROUP_WIDTH: Readonly<Record<string, string>> = { width: GROUP_WIDTH, "box-sizing": "border-box" }

/** What makes a group whose items take its content width their query container: on its inline axis alone. */
const SIZE_CONTAINER: Readonly<Record<string, string>> = { "container-type": "inline-size" }

/**
 * The group element's style for `places`, `geometry` and `n` items, under `own`: positioned, its direction,
 * and sized to its places, or, a grid whose width isn't read yet, laid out by CSS (Q37; #714, Q5): CSS grid
 * for items of one size, `flex-wrap` for each their own, the same on the server and the client, so
 * hydrating keeps the markup. Items that take its content width have it as their query container (#714).
 */
export const groupStyleOf = (places: BatchReorderPlaces, n: number, geometry: BatchReorderGeometry, own: Style.Input): Style.Style => {
  const positioned = { ...ReorderController.GROUP_STYLE, position: "relative", direction: geometry.direction }
  const base: Readonly<Record<string, string>> = Bool.match(places.takesWidth, { onTrue: () => ({ ...positioned, ...SIZE_CONTAINER }), onFalse: () => positioned })
  const sized: Readonly<Record<string, string>> = Bool.match(inGridFlow(geometry), {
    onTrue: () => flowStyleOf(places, geometry, base),
    onFalse: () => {
      const extent = extentOf(places, n)
      // Its width the app's (Q36; #714).
      return Bool.match(places.appsWidth, {
        onTrue: () => ({ ...base, height: px(extent.height) }),
        onFalse: () => ({ ...base, width: px(extent.width), height: px(extent.height) }),
      })
    },
  })
  return Style.over(own, sized)
}

/** A grid in flow's style: CSS grid's columns for items of one size, `flex-wrap`'s rows for each their own (#714, Q5). */
const flowStyleOf = (places: BatchReorderPlaces, geometry: BatchReorderGeometry, base: Readonly<Record<string, string>>): Readonly<Record<string, string>> => {
  const gap = gapOf(geometry)
  return Bool.match(Predicate.isUndefined(places.each), {
    onTrue: () => ({ ...base, display: "grid", "grid-template-columns": `repeat(auto-fill, ${px(places.itemSize.width)})`, "column-gap": px(gap.x), "row-gap": px(gap.y) }),
    onFalse: () => ({ ...base, display: "flex", "flex-wrap": "wrap", "align-items": "flex-start", "column-gap": px(gap.x), "row-gap": px(gap.y) }),
  })
}

/** A Reorder item's drag axis for its group's: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

/**
 * An item's own style under its group's: a drag element's defaults; sized, its items one size; and, unless
 * its group lays it out in flow, absolute at its static position (no `top` or `left`): the start of the
 * group's content box. Items each their own size are sized each by {@link sizeStyleOf} (#714).
 */
export const itemBaseOf = (geometry: BatchReorderGeometry): Readonly<Record<string, string>> => {
  const drag = Style.dragDefaults(dragAxisFor(geometry.axis))
  const base: Readonly<Record<string, string>> = Bool.match(Predicate.isFunction(geometry.itemSize), {
    onTrue: () => drag,
    onFalse: () => ({ ...drag, ...sizeStyle((geometry.itemSize as ReorderBatchColumnSize).width, (geometry.itemSize as ReorderBatchColumnSize).height) }),
  })
  return Bool.match(inGridFlow(geometry), { onTrue: () => ({ ...base, ...IN_FLOW }), onFalse: () => ({ ...base, position: "absolute" }) })
}

/** An item in flow's own: unshrunk, as wide as at its place, its row breaking where its place's does (#714). */
const IN_FLOW: Readonly<Record<string, string>> = { "flex-shrink": "0" }

/** An item's size as style: its width, or the group's content width, border-box (#714, Q10); and its height. */
const sizeStyle = (width: number | undefined, height: number): Readonly<Record<string, string>> =>
  UndefinedOr.match(width, {
    onUndefined: () => ({ ...TAKES_GROUP_WIDTH, height: px(height) }),
    onDefined: (w) => ({ width: px(w), height: px(height) }),
  })

/** Item `i`'s own size as style, its items each their own size (#714): `width` and `height`, or none. */
export const sizeStyleOf = (places: BatchReorderPlaces, i: number): Readonly<Record<string, string>> => {
  // Per element at mount, by the hot path's rules: statements.
  const each = places.each
  if (Predicate.isUndefined(each)) return NO_STYLE
  const width = each.widths[i]
  if (Number.isNaN(width)) return { ...TAKES_GROUP_WIDTH, height: px(each.heights[i]) }
  return { width: px(width), height: px(each.heights[i]) }
}

const NO_STYLE: Readonly<Record<string, string>> = {}

/** A size last written on an item's element (#714): its width `NaN` when it took the group's. */
export interface WrittenSize {
  readonly width: number
  readonly height: number
}

/** An element whose width was the group's, `was`, written no longer: its own `box-sizing` back (#714). */
export const releaseGroupWidth = (el: HTMLElement, was: WrittenSize | undefined): void => {
  // Per item at a change: statements.
  if (Predicate.isNotUndefined(was) && Number.isNaN(was.width)) el.style.removeProperty("box-sizing")
}

/**
 * Item `i`'s own size written on `el`, its items each their own size (#714), where it isn't already: what
 * `written` holds, by element, is what was last written.
 */
export const writeSizeOn = (el: HTMLElement, places: BatchReorderPlaces, i: number, written: WeakMap<Element, WrittenSize>): void => {
  // Per item at a change: statements.
  const each = places.each
  if (Predicate.isUndefined(each)) return
  const width = each.widths[i]
  const height = each.heights[i]
  const was = written.get(el)
  if (Predicate.isNotUndefined(was) && Object.is(was.width, width) && was.height === height) return
  written.set(el, { width, height })
  el.style.setProperty("height", px(height))
  if (Number.isNaN(width)) {
    el.style.setProperty("width", TAKES_GROUP_WIDTH.width)
    el.style.setProperty("box-sizing", TAKES_GROUP_WIDTH["box-sizing"])
    return
  }
  el.style.setProperty("width", px(width))
  releaseGroupWidth(el, was)
}

/**
 * A style as CSS text: the one every item of a group shares, written once as each is made, where a key at
 * a time cost each item a write per key (#712, Q47).
 */
export const cssTextOf = (style: Style.Style): string => Arr.join(Arr.map(Rec.toEntries(style), ([key, value]) => `${key}:${String(value)}`), ";")

/** Whether two styles have the same keys, each at the same value. */
export const sameStyle: Equivalence.Equivalence<Style.Style> = Rec.makeEquivalence(Equivalence.strictEqual<unknown>())
