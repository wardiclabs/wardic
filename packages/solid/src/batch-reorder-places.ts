/**
 * A **Batch Reorder group**'s places (#712, ADR-0072 decisions 3 and 4), Solid-free and DOM-free but for
 * the style strings: where each item goes, from its index, and how the group and its items are styled.
 *
 * - **Places**: `axis` picks the shape, a column (`"y"`), a row (`"x"`) or a wrapping grid (`"xy"`), `gap`
 *   apart. Every item one size: a grid's `columns`, else as many as the group's width holds (Q36). Each its
 *   own size, a function's (#714, *Amendment (#714)*): each place after the sizes before it, a grid's rows
 *   breaking where the next item doesn't fit the group's width, each item at its row's top.
 * - **A column's items may take the group's content width** (#714, Q10), exact on the server too: `100%` in
 *   flow; placed, their padding box less the group's padding, once it's read; before, `100cqi`, the group a
 *   size container ({@link groupWidthOf}).
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
  | {
    readonly axis?: CoreReorder.Axis | undefined
    /** Left out, each item's size is read from the page: its own content's, a column's items as wide as the group. */
    readonly itemSize?: undefined
    readonly columns?: undefined
  }

/**
 * A group's `itemSize` as its places read it, whatever its shape: one size, a function of each item, or
 * none, each item's read from the page (#714).
 */
export type BatchReorderItemSizes = ReorderBatchColumnSize | ((item: never, i: number) => ReorderBatchColumnSize) | undefined

/** A point, or a length on each axis, in px. */
export interface XY {
  readonly x: number
  readonly y: number
}

/** The space between a Batch Reorder group's places, in px: one for both axes, or each its own. */
export type ReorderBatchGap = number | XY

/** A group's direction: its places from its content box's left, or, right to left, from its right. */
export type BatchReorderDirection = "ltr" | "rtl"

/**
 * What the group reads of its element once it's on the page (Q35, Q36): the direction it inherits, its
 * content box's width, and its edges.
 */
export interface BatchReorderRead {
  readonly direction: BatchReorderDirection
  /**
   * Its content width, read where its places come from it, a grid with no `columns`, of one size or each
   * its own (#714); `undefined` for any other.
   */
  readonly width: number | undefined
  /**
   * What its own `width` and `height` hold besides its content box, on each axis (#714): its padding and
   * border when it's `border-box`, as a CSS reset makes it; none when it's `content-box`.
   */
  readonly edges: XY
  /**
   * Its horizontal padding (#714): what an absolutely placed item's `100%`, its padding box's width, holds
   * besides its content box's.
   */
  readonly padding: number
}

/** Whether two reads of a group's element are alike: the same direction, width, edges and padding. */
export const sameRead = (a: BatchReorderRead | undefined, b: BatchReorderRead | undefined): boolean =>
  UndefinedOr.match(a, {
    onUndefined: () => Predicate.isUndefined(b),
    onDefined: (x) =>
      UndefinedOr.match(b, {
        onUndefined: () => false,
        onDefined: (y) => Bool.every([x.direction === y.direction, x.width === y.width, x.edges.x === y.edges.x, x.edges.y === y.edges.y, x.padding === y.padding]),
      }),
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
  /** What its own size holds besides its content box (#714): none before it's read, a server's. */
  readonly edges: XY
  /** Its horizontal padding (#714): `undefined` before it's read, a server's. */
  readonly padding: number | undefined
}

/** What a group's props give its geometry, as either binding reads them. */
export interface BatchReorderProps {
  readonly axis?: CoreReorder.Axis | undefined
  readonly itemSize?: BatchReorderItemSizes
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
  edges: UndefinedOr.match(read, { onUndefined: () => NO_EDGES, onDefined: (r) => r.edges }),
  padding: UndefinedOr.match(read, { onUndefined: () => undefined, onDefined: (r) => r.padding }),
})

/** No edges: a `content-box` group's, and a group's before its first read. */
const NO_EDGES: XY = { x: 0, y: 0 }

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
  /** Whether any item takes the group's content width (#714, Q10): {@link groupWidthOf}'s. */
  readonly takesWidth: boolean
  /** Each item's place and size, its items each their own size (#714); `undefined` when they're one. */
  readonly each: ItemPlaces | undefined
  /** Whether its items' sizes are read from the page (#714): never written on them. */
  readonly sizesRead: boolean
  /**
   * Whether its items are laid out in flow by CSS, each at no place: a grid whose rows break at a width it
   * hasn't read (Q37), or items whose sizes it hasn't read yet (#714, decision 4).
   */
  readonly inFlow: boolean
  /** The width an item that takes the group's content width is given ({@link groupWidthOf}). */
  readonly groupWidth: string
}

/**
 * What a group has read of its items' sizes, their sizes left out of `itemSize` (#714): each one's, by its
 * value, and whether its first came in. Until then its items are in flow.
 */
export interface SizesRead {
  /** An item's border box, as last read; `undefined` until it's read. */
  readonly sizeOf: (item: unknown) => ReorderBatchItemSize | undefined
  readonly arrived: boolean
}

/** No sizes read: a server's, and a client's before its first. */
export const NONE_READ: SizesRead = { sizeOf: () => undefined, arrived: false }

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

/** Whether a group reads its items' sizes from the page: its `itemSize` left out (#714). */
export const readsSizes = (geometry: BatchReorderGeometry): boolean => Predicate.isUndefined(geometry.itemSize)

/**
 * Whether a group's items are in flow, its first sizes `arrived` or not: a grid's width unread, or its items'
 * sizes, read from the page (#714).
 */
export const itemsInFlow = (geometry: BatchReorderGeometry, arrived: boolean): boolean => {
  // Per element at mount, by the hot path's rules: statements.
  if (inGridFlow(geometry)) return true
  return readsSizes(geometry) && !arrived
}

/** Whether `places` are of items each their own size given by a function (#714): those written on their elements. */
export const writesSizes = (places: BatchReorderPlaces): boolean => Bool.and(Predicate.isNotUndefined(places.each), Bool.not(places.sizesRead))

/** Each direction's way along a row: rightward, or leftward from the right edge. */
const SIGN_X: Readonly<Record<BatchReorderDirection, number>> = { ltr: 1, rtl: -1 }

/** A function `itemSize` as the places call it. */
type SizeOf = (item: unknown, i: number) => ReorderBatchColumnSize

/**
 * `geometry`'s places for `values`: every item one size, each its own, a function's, or each its own as
 * `read` from the page (#714). An error names a grid's `columns` that isn't a whole number.
 */
export const resolvePlaces = (geometry: BatchReorderGeometry, values: ReadonlyArray<unknown>, read: SizesRead = NONE_READ): BatchReorderPlaces => {
  const itemSize = geometry.itemSize
  if (Predicate.isUndefined(itemSize)) return resolveRead(geometry, values, read)
  if (Predicate.isFunction(itemSize)) return resolveEach(geometry, values, itemSize as SizeOf)
  return resolveOne(geometry, values.length, itemSize)
}

/** Places for `n` items of one size, a column's width the group's when it gives none (#714, Q10): never read, 0 here. */
const resolveOne = (geometry: BatchReorderGeometry, n: number, size: ReorderBatchColumnSize): BatchReorderPlaces => {
  const gap = gapOf(geometry)
  const inFlow = inGridFlow(geometry)
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
    sizesRead: false,
    inFlow,
    groupWidth: groupWidthOf(geometry, inFlow),
  }
}

/** Places for `values`, each its own size, `sizeOf`'s (#714): laid out by the group's axis. */
const resolveEach = (geometry: BatchReorderGeometry, values: ReadonlyArray<unknown>, sizeOf: SizeOf): BatchReorderPlaces => {
  const inFlow = inGridFlow(geometry)
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
    sizesRead: false,
    inFlow,
    groupWidth: groupWidthOf(geometry, inFlow),
  }
}

/** A size not read yet: none, its place from the sizes before it. A column's, its width the group's. */
const UNREAD: ReorderBatchColumnSize = { width: 0, height: 0 }
const UNREAD_IN_COLUMN: ReorderBatchColumnSize = { width: undefined, height: 0 }

/** Each item's size as read, a column's height alone: its width is the group's (Q6). */
const readInColumn = (read: SizesRead): SizeOf => (item) => {
  // Per item at a change: statements.
  const size = read.sizeOf(item)
  if (Predicate.isUndefined(size)) return UNREAD_IN_COLUMN
  return { width: undefined, height: size.height }
}

/** Each item's size as read: its width and height its own (Q6). */
const readOwn = (read: SizesRead): SizeOf => (item) => {
  // Per item at a change: statements.
  const size = read.sizeOf(item)
  if (Predicate.isUndefined(size)) return UNREAD
  return size
}

/** Each axis's reading of an item's size. Built once, at module load. */
const readBy: (axis: CoreReorder.Axis) => (read: SizesRead) => SizeOf = Match.type<CoreReorder.Axis>().pipe(
  Match.when("y", () => readInColumn),
  Match.orElse(() => readOwn),
)

/**
 * Places for `values`, each its own size as `read` from the page (#714): laid out as a function's sizes are.
 * In flow, before its first sizes or a grid's width, every item at no place, where CSS has it.
 */
const resolveRead = (geometry: BatchReorderGeometry, values: ReadonlyArray<unknown>, read: SizesRead): BatchReorderPlaces => {
  const places = resolveEach(geometry, values, readBy(geometry.axis)(read))
  const inFlow = itemsInFlow(geometry, read.arrived)
  // A column's items take its width, whether it has any or not (Q6).
  const takesWidth = geometry.axis === "y"
  const appsWidth = Bool.or(isFromWidth(geometry), takesWidth)
  const each = UndefinedOr.getOrThrow(places.each)
  return {
    ...places,
    sizesRead: true,
    inFlow,
    groupWidth: groupWidthOf(geometry, inFlow),
    takesWidth,
    appsWidth,
    width: Bool.match(appsWidth, { onTrue: () => readWidthOf(geometry), onFalse: () => each.width }),
    each: Bool.match(inFlow, { onTrue: () => atNoPlace(each), onFalse: () => each }),
  }
}

/** `each` with every item at no place: in flow, where CSS has it; the group's size its flow's. */
const atNoPlace = (each: ItemPlaces): ItemPlaces => ({ ...each, xs: new Float64Array(each.xs.length), ys: new Float64Array(each.ys.length), width: 0, height: 0 })

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

/** A size container's whole inline size: its content box's. */
const CONTAINER_WIDTH = "100cqi"

/**
 * The width of an item that takes the group's content width (#714, Q10), `inFlow` or not, its padding and
 * border inside it (border-box). In flow, `100%`: its content box's. Placed, once the group's padding is
 * read, its padding box's (an absolutely placed box's `100%`) less that padding: a resize of the group is
 * then a layout alone. Before, a server's, all of a size container's inline size, the group being one
 * ({@link containsWidth}): exact, at a style recalc of every item each time the group's width changes.
 */
export const groupWidthOf = (geometry: BatchReorderGeometry, inFlow: boolean): string =>
  Bool.match(inFlow, {
    onTrue: () => "100%",
    onFalse: () =>
      UndefinedOr.match(geometry.padding, {
        onUndefined: () => CONTAINER_WIDTH,
        onDefined: (padding) => Bool.match(padding === 0, { onTrue: () => "100%", onFalse: () => `calc(100% - ${px(padding)})` }),
      }),
  })

/** The style of an item that takes the group's content width, `width`: that width, its padding and border inside it. */
const groupWidthStyle = (width: string): Readonly<Record<string, string>> => ({ width, "box-sizing": "border-box" })

/** Whether `places`' group is its items' size container: they take its width, out of flow, its padding not read. */
const containsWidth = (places: BatchReorderPlaces, geometry: BatchReorderGeometry): boolean =>
  Bool.every([places.takesWidth, Bool.not(places.inFlow), Predicate.isUndefined(geometry.padding)])

/** What makes a group whose items take its content width their query container: on its inline axis alone. */
const SIZE_CONTAINER: Readonly<Record<string, string>> = { "container-type": "inline-size" }

/**
 * The group element's style for `places`, `geometry` and `n` items, under `own`: positioned, its direction,
 * and sized to its places, or, a grid whose width isn't read yet, laid out by CSS (Q37; #714, Q5): CSS grid
 * for items of one size, `flex-wrap` for each their own, the same on the server and the client, so
 * hydrating keeps the markup. Items that take its content width have it as their query container until its
 * padding is read, out of flow (#714).
 */
export const groupStyleOf = (places: BatchReorderPlaces, n: number, geometry: BatchReorderGeometry, own: Style.Input): Style.Style => {
  const positioned = { ...ReorderController.GROUP_STYLE, position: "relative", direction: geometry.direction }
  const base: Readonly<Record<string, string>> = Bool.match(containsWidth(places, geometry), { onTrue: () => ({ ...positioned, ...SIZE_CONTAINER }), onFalse: () => positioned })
  const sized: Readonly<Record<string, string>> = Bool.match(places.inFlow, {
    onTrue: () => flowStyleOf(places, geometry, base),
    onFalse: () => {
      const extent = extentOf(places, n)
      // Its width the app's (Q36; #714). Its own size holds its edges too, a `border-box` group's (#714).
      const height = px(extent.height + geometry.edges.y)
      return Bool.match(places.appsWidth, {
        onTrue: () => ({ ...base, height }),
        onFalse: () => ({ ...base, width: px(extent.width + geometry.edges.x), height }),
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
    onFalse: () => ({ ...base, ...eachFlowBy(geometry.axis)(gap) }),
  })
}

/**
 * Each axis's flow for items each their own size (#714, decision 4), where their places would put them: a
 * column, its items as wide as its content box; a row at its items' tops, as wide as they are, so it's as
 * wide as its places make it; rows that wrap. Built once, at module load.
 */
const eachFlowBy: (axis: CoreReorder.Axis) => (gap: XY) => Readonly<Record<string, string>> = Match.type<CoreReorder.Axis>().pipe(
  Match.when("y", () => (gap: XY) => ({ display: "flex", "flex-direction": "column", "row-gap": px(gap.y) })),
  Match.when("x", () => (gap: XY) => ({ display: "flex", "flex-direction": "row", "align-items": "flex-start", "column-gap": px(gap.x), width: "max-content" })),
  Match.orElse(() => (gap: XY) => ({ display: "flex", "flex-wrap": "wrap", "align-items": "flex-start", "column-gap": px(gap.x), "row-gap": px(gap.y) })),
)

/** A Reorder item's drag axis for its group's: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

/**
 * An item's own style under its group's, `inFlow` or not: a drag element's defaults; sized, its items one
 * size; a column's items read from the page as wide as the group (#714, Q6); and, unless its group lays it out
 * in flow, absolute at its static position (no `top` or `left`): the start of the group's content box. Items
 * each their own size, a function's, are sized each by {@link sizeStyleOf} (#714).
 */
export const itemBaseOf = (geometry: BatchReorderGeometry, inFlow: boolean): Readonly<Record<string, string>> => {
  const drag = Style.dragDefaults(dragAxisFor(geometry.axis))
  const base = sizedBy(geometry, drag, groupWidthOf(geometry, inFlow))
  return Bool.match(inFlow, { onTrue: () => ({ ...base, ...IN_FLOW }), onFalse: () => ({ ...base, position: "absolute" }) })
}

/**
 * `drag` with every item's size, its group's one size; the group's width, `groupWidth`, a column's read from the
 * page; or none.
 */
const sizedBy = (geometry: BatchReorderGeometry, drag: Readonly<Record<string, string>>, groupWidth: string): Readonly<Record<string, string>> => {
  // Per element at mount, by the hot path's rules: statements.
  const itemSize = geometry.itemSize
  if (Predicate.isUndefined(itemSize)) {
    if (geometry.axis !== "y") return drag
    return { ...drag, ...groupWidthStyle(groupWidth) }
  }
  if (Predicate.isFunction(itemSize)) return drag
  return { ...drag, ...sizeStyle(itemSize.width, itemSize.height, groupWidth) }
}

/** An item in flow's own: unshrunk, as wide as at its place, its row breaking where its place's does (#714). */
const IN_FLOW: Readonly<Record<string, string>> = { "flex-shrink": "0" }

/** An item's size as style: its width, or the group's content width, `groupWidth`, border-box (#714, Q10); and its height. */
const sizeStyle = (width: number | undefined, height: number, groupWidth: string): Readonly<Record<string, string>> =>
  UndefinedOr.match(width, {
    onUndefined: () => ({ ...groupWidthStyle(groupWidth), height: px(height) }),
    onDefined: (w) => ({ width: px(w), height: px(height) }),
  })

/** Item `i`'s own size as style, its items each their own size (#714): `width` and `height`, or none. */
export const sizeStyleOf = (places: BatchReorderPlaces, i: number): Readonly<Record<string, string>> => {
  // Per element at mount, by the hot path's rules: statements.
  const each = places.each
  if (Predicate.isUndefined(each) || places.sizesRead) return NO_STYLE
  const width = each.widths[i]
  if (Number.isNaN(width)) return { ...groupWidthStyle(places.groupWidth), height: px(each.heights[i]) }
  return { width: px(width), height: px(each.heights[i]) }
}

const NO_STYLE: Readonly<Record<string, string>> = {}

/** A size last written on an item's element (#714): its width and height as written, and whether the width was the group's. */
export interface WrittenSize {
  readonly width: string
  readonly height: string
  readonly tookGroupWidth: boolean
}

/** An element whose width was the group's, `was`, written no longer: its own `box-sizing` back (#714). */
export const releaseGroupWidth = (el: HTMLElement, was: WrittenSize | undefined): void => {
  // Per item at a change: statements.
  if (Predicate.isNotUndefined(was) && was.tookGroupWidth) el.style.removeProperty("box-sizing")
}

/**
 * `el`'s own size as `was` written, taken back where its style is still that: its items' sizes read from the
 * page now (#714). A width that was the group's stays, a column's read from the page being the group's too.
 */
export const unwriteSizeOn = (el: HTMLElement, was: WrittenSize | undefined): void => {
  // Per item at a change: statements.
  if (Predicate.isUndefined(was)) return
  if (el.style.height === was.height) el.style.removeProperty("height")
  if (!was.tookGroupWidth && el.style.width === was.width) el.style.removeProperty("width")
}

/**
 * Item `i`'s own size written on `el`, its items each their own size (#714), where it isn't already: what
 * `written` holds, by element, is what was last written.
 */
export const writeSizeOn = (el: HTMLElement, places: BatchReorderPlaces, i: number, written: WeakMap<Element, WrittenSize>): void => {
  // Per item at a change: statements.
  const each = places.each
  if (Predicate.isUndefined(each) || places.sizesRead) return
  const tookGroupWidth = Number.isNaN(each.widths[i])
  let width = places.groupWidth
  if (!tookGroupWidth) width = px(each.widths[i])
  const height = px(each.heights[i])
  const was = written.get(el)
  if (Predicate.isNotUndefined(was) && was.width === width && was.height === height) return
  written.set(el, { width, height, tookGroupWidth })
  el.style.setProperty("height", height)
  el.style.setProperty("width", width)
  if (tookGroupWidth) {
    el.style.setProperty("box-sizing", "border-box")
    return
  }
  releaseGroupWidth(el, was)
}

/**
 * A style as CSS text: the one every item of a group shares, written once as each is made, where a key at
 * a time cost each item a write per key (#712, Q47).
 */
export const cssTextOf = (style: Style.Style): string => Arr.join(Arr.map(Rec.toEntries(style), ([key, value]) => `${key}:${String(value)}`), ";")

/** Whether two styles have the same keys, each at the same value. */
export const sameStyle: Equivalence.Equivalence<Style.Style> = Rec.makeEquivalence(Equivalence.strictEqual<unknown>())
