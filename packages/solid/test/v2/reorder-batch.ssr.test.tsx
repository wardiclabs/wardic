// `Reorder.BatchGroup` on Solid 2's server (#712's PR 3, Q37, Q39), with Solid's server build in the `node`
// environment, on DomLive.
//
// - BS1: a column: the group sized to its places, `overflow-anchor: none`; each item in the list's order, at
//   its static position (no `top` or `left`) and its place (the DOM writer's own transform), sized, with a
//   drag element's defaults and a tab stop.
// - BS2: `direction="rtl"` mirrors a row's places on the server, and the group takes the direction.
// - BS3: a grid with no `columns` lays its items out by CSS grid, each in flow at its size: the server can't
//   know the width (Q37).
// - BS4: `initial` starts each item at its place and at the keys it gives.
//
// Items of different sizes, given by a function (#714, ADR-0072 *Amendment (#714)*):
// - BS5: a column: each item its own height, each place below the one before, a gap apart; the group as
//   tall as them all, as wide as the widest.
// - BS6: a row: each item its own width and height at the row's top; the group as wide as them all, as tall
//   as the tallest. BS7: right to left, leftward from the right edge.
// - BS8: a column whose `width` is left out (Q10), an object or a function's: each item as wide as the
//   group's content box, border-box, by CSS: the group a size container, each item `100cqi`; the group sets
//   no width of its own.
// - BS9: a grid (`"xy"`) of sizes from a function lays its items out in flow by `flex-wrap` until its width
//   is read: the server can't know where its rows break (Q5); each keeps its width there, unshrunk, as at its
//   place.
// - BS10: `initial` starts each item at its place and at the keys it gives.
// - BS11: an item's own style gives way to the function's size, as on the client: the size places it.
// - BT1: `columns` with a function `itemSize` is a type error, and so is a size with no `width` off a column;
//   an item's value is of any type, its element's own `value` attribute aside.
import * as DomBatch from "@wardic/dom/DomBatch"
import { Reorder, type ReorderBatchSizing, type WardicBatchValues } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { For } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr.ts"

const VALUES = ["a", "b", "c", "d", "e"]

/** The style the DOM writer draws `values` on `keys` with: what the server must write. */
const writerStyleOf = (values: WardicBatchValues): Record<string, string> => DomBatch.styleOf(values as Readonly<Record<string, number>>)

interface Scene {
  readonly axis: "x" | "y" | "xy"
  readonly columns?: number
  readonly direction?: "ltr" | "rtl"
  readonly initial?: WardicBatchValues
}

const list = (scene: Scene) => () => (
  <Reorder.BatchGroup
    values={VALUES}
    onReorder={() => {}}
    axis={scene.axis}
    itemSize={Bool.match(scene.axis === "y", { onTrue: () => ({ width: 200, height: 50 }), onFalse: () => ({ width: 80, height: 50 }) })}
    gap={10}
    {...UndefinedOr.match(scene.columns, { onUndefined: () => ({}), onDefined: (columns) => ({ columns }) })}
    {...UndefinedOr.match(scene.direction, { onUndefined: () => ({}), onDefined: (direction) => ({ direction }) })}
    {...UndefinedOr.match(scene.initial, { onUndefined: () => ({}), onDefined: (initial) => ({ initial }) })}
  >
    <For each={VALUES}>
      {(value) => (
        <Reorder.BatchItem value={value} data-value={value} style={{ background: "teal" }}>
          {value}
        </Reorder.BatchItem>
      )}
    </For>
  </Reorder.BatchGroup>
)

/** A drag element's defaults on a server-rendered tag, with `touchAction` for its axis: Solid 1's `expectDragDefaults`. */
const expectDragDefaults = (t: ReturnType<typeof tagsOf>[number], touchAction: string): void => {
  expect(t.attrs.draggable, `${t.name} draggable`).toBe("false")
  expect(t.style["touch-action"], `${t.name} touch-action`).toBe(touchAction)
  expect(t.style["user-select"], `${t.name} user-select`).toBe("none")
}

describe("Reorder.BatchGroup on a server, on Solid 2", () => {
  it("BS1: a column: the group sized, each item at its place, sized, with the drag defaults and a tab stop", () => {
    const [group, ...items] = tagsOf(serve(list({ axis: "y" })))
    expect(group?.name).toBe("ul")
    expect([group?.style.position, group?.style.width, group?.style.height, group?.style["overflow-anchor"]]).toEqual(["relative", "200px", "290px", "none"])
    expect(items.map((t) => t.attrs["data-value"])).toEqual(VALUES)
    items.forEach((item, i) => {
      // No `top` or `left`: at its static position, the group's content box's start, its padding kept.
      expect([item.name, item.style.position, item.style.top, item.style.left, item.style.width, item.style.height]).toEqual(["li", "absolute", undefined, undefined, "200px", "50px"])
      expect(item.style.transform, `${VALUES[i]}'s place`).toBe(writerStyleOf({ y: i * 60 }).transform)
      expect(item.style.background).toBe("teal")
      expect(item.attrs.tabindex).toBe("0")
      expectDragDefaults(item, "pan-x")
    })
  })

  it("BS2: direction rtl mirrors a row's places, and the group takes the direction", () => {
    const [group, ...items] = tagsOf(serve(list({ axis: "x", direction: "rtl" })))
    expect([group?.style.direction, group?.style.width]).toEqual(["rtl", "440px"])
    // Right to left, each item's static position is at the group's right edge, its place leftward from there.
    expect(items.map((item) => item.style.transform)).toEqual([0, 1, 2, 3, 4].map((i) => writerStyleOf({ x: -i * 90 }).transform))
  })

  it("BS3: a grid with no columns lays out by CSS grid, each item in flow", () => {
    const [group, ...items] = tagsOf(serve(list({ axis: "xy" })))
    expect([group?.style.display, group?.style["grid-template-columns"], group?.style["column-gap"], group?.style["row-gap"]]).toEqual(["grid", "repeat(auto-fill, 80px)", "10px", "10px"])
    expect(group?.style.height, "its height its rows'").toBeUndefined()
    items.forEach((item) => {
      expect([item.style.position, item.style.transform, item.style.width, item.style.height]).toEqual([undefined, undefined, "80px", "50px"])
    })
  })

  it("BS4: initial starts each item at its place, at the keys it gives", () => {
    const [, ...items] = tagsOf(serve(list({ axis: "y", initial: { opacity: 0 } })))
    items.forEach((item, i) => {
      expect([item.style.transform, item.style.opacity]).toEqual([writerStyleOf({ y: i * 60 }).transform, "0"])
    })
  })
})

/** Each item's own size (#714): by its value, so a reorder carries it. */
const WIDTHS: Readonly<Record<string, number>> = { a: 80, b: 120, c: 60, d: 100, e: 40 }
const HEIGHTS: Readonly<Record<string, number>> = { a: 40, b: 70, c: 50, d: 90, e: 60 }
/** Where each item starts along its axis, a 10 px gap after each: the widths' and the heights' running sums. */
const XS = [0, 90, 220, 290, 400]
const YS = [0, 50, 130, 190, 290]

interface SizedScene {
  readonly axis: "x" | "y" | "xy"
  readonly direction?: "ltr" | "rtl"
  readonly initial?: WardicBatchValues
}

const sizedList = (scene: SizedScene) => () => (
  <Reorder.BatchGroup
    values={VALUES}
    onReorder={() => {}}
    axis={scene.axis}
    itemSize={(value: string) => ({ width: WIDTHS[value]!, height: HEIGHTS[value]! })}
    gap={10}
    {...UndefinedOr.match(scene.direction, { onUndefined: () => ({}), onDefined: (direction) => ({ direction }) })}
    {...UndefinedOr.match(scene.initial, { onUndefined: () => ({}), onDefined: (initial) => ({ initial }) })}
  >
    <For each={VALUES}>
      {(value) => (
        <Reorder.BatchItem value={value} data-value={value}>
          {value}
        </Reorder.BatchItem>
      )}
    </For>
  </Reorder.BatchGroup>
)

/** A column whose items take the group's content width (Q10): an object's `itemSize`, or a function's. */
const columnList = (sizing: ReorderBatchSizing<string>) => () => (
  <Reorder.BatchGroup values={VALUES} onReorder={() => {}} {...sizing} gap={10}>
    <For each={VALUES}>{(value) => <Reorder.BatchItem value={value}>{value}</Reorder.BatchItem>}</For>
  </Reorder.BatchGroup>
)

/** An item's width when it takes the group's content width: all of its query container's, the group's. */
const GROUP_WIDTH = "100cqi"

describe("Reorder.BatchGroup of items of different sizes on a server, on Solid 2 (#714)", () => {
  it("BS5: a column: each item its own height, each place below the one before; the group as tall as them all", () => {
    const [group, ...items] = tagsOf(serve(sizedList({ axis: "y" })))
    expect([group?.style.position, group?.style.width, group?.style.height, group?.style["container-type"]], "no container: every item gives its width").toEqual(["relative", "120px", "350px", undefined])
    items.forEach((item, i) => {
      const value = VALUES[i]!
      expect([item.style.position, item.style.width, item.style.height], value).toEqual(["absolute", `${WIDTHS[value]}px`, `${HEIGHTS[value]}px`])
      expect(item.style.transform, `${value}'s place`).toBe(writerStyleOf({ y: YS[i]! }).transform)
      expectDragDefaults(item, "pan-x")
    })
  })

  it("BS6: a row: each item its own size at the row's top; the group as wide as them all, as tall as the tallest", () => {
    const [group, ...items] = tagsOf(serve(sizedList({ axis: "x" })))
    expect([group?.style.width, group?.style.height]).toEqual(["440px", "90px"])
    items.forEach((item, i) => {
      const value = VALUES[i]!
      expect([item.style.width, item.style.height], value).toEqual([`${WIDTHS[value]}px`, `${HEIGHTS[value]}px`])
      expect(item.style.transform, `${value}'s place`).toBe(writerStyleOf({ x: XS[i]! }).transform)
    })
  })

  it("BS7: right to left, a row's places go leftward from the right edge", () => {
    const [group, ...items] = tagsOf(serve(sizedList({ axis: "x", direction: "rtl" })))
    expect([group?.style.direction, group?.style.width]).toEqual(["rtl", "440px"])
    expect(items.map((item) => item.style.transform)).toEqual(XS.map((x) => writerStyleOf({ x: -x }).transform))
  })

  it("BS8: a column whose width is left out: each item the group's content width, border-box; the group sets none", () => {
    const uniform = tagsOf(serve(columnList({ itemSize: { height: 50 } })))
    expect([uniform[0]?.style.width, uniform[0]?.style.height, uniform[0]?.style["container-type"]]).toEqual([undefined, "290px", "inline-size"])
    uniform.slice(1).forEach((item, i) => {
      expect([item.style.width, item.style["box-sizing"], item.style.height]).toEqual([GROUP_WIDTH, "border-box", "50px"])
      expect(item.style.transform).toBe(writerStyleOf({ y: i * 60 }).transform)
    })
    const each = tagsOf(serve(columnList({ itemSize: (value) => ({ height: HEIGHTS[value]! }) })))
    expect([each[0]?.style.width, each[0]?.style.height, each[0]?.style["container-type"]]).toEqual([undefined, "350px", "inline-size"])
    each.slice(1).forEach((item, i) => {
      expect([item.style.width, item.style["box-sizing"], item.style.height]).toEqual([GROUP_WIDTH, "border-box", `${HEIGHTS[VALUES[i]!]}px`])
      expect(item.style.transform).toBe(writerStyleOf({ y: YS[i]! }).transform)
    })
  })

  it("BS9: a grid of sizes from a function lays out in flow by flex-wrap until its width is read", () => {
    const [group, ...items] = tagsOf(serve(sizedList({ axis: "xy" })))
    expect([group?.style.display, group?.style["flex-wrap"], group?.style["align-items"], group?.style["column-gap"], group?.style["row-gap"]]).toEqual(["flex", "wrap", "flex-start", "10px", "10px"])
    expect([group?.style.width, group?.style.height], "its size the app's and its rows'").toEqual([undefined, undefined])
    items.forEach((item, i) => {
      const value = VALUES[i]!
      expect([item.style.position, item.style.transform, item.style.width, item.style.height, item.style["flex-shrink"]], value).toEqual([undefined, undefined, `${WIDTHS[value]}px`, `${HEIGHTS[value]}px`, "0"])
    })
  })

  it("BS10: initial starts each item at its place, at the keys it gives", () => {
    const [, ...items] = tagsOf(serve(sizedList({ axis: "y", initial: { opacity: 0 } })))
    items.forEach((item, i) => {
      expect([item.style.transform, item.style.opacity]).toEqual([writerStyleOf({ y: YS[i]! }).transform, "0"])
    })
  })

  it("BS11: an item's own style gives way to the function's size", () => {
    const [, ...items] = tagsOf(serve(() => (
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="x" itemSize={(value: string) => ({ width: WIDTHS[value]!, height: HEIGHTS[value]! })} gap={10}>
        <For each={VALUES}>
          {(value) => (
            <Reorder.BatchItem value={value} style={{ width: "999px", height: "1px", background: "teal" }}>
              {value}
            </Reorder.BatchItem>
          )}
        </For>
      </Reorder.BatchGroup>
    )))
    items.forEach((item, i) => {
      const value = VALUES[i]!
      expect([item.style.width, item.style.height, item.style.background], value).toEqual([`${WIDTHS[value]}px`, `${HEIGHTS[value]}px`, "teal"])
    })
  })

  it("BT1: columns with a function itemSize is a type error, as is a size with no width off a column", () => {
    const CLIPS = [{ name: "Intro", seconds: 4 }, { name: "Verse", seconds: 12 }]
    const sized = (value: string) => ({ width: WIDTHS[value]!, height: HEIGHTS[value]! })
    const typed = () => [
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="xy" itemSize={{ width: 80, height: 50 }} columns={3} />,
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="xy" itemSize={sized} />,
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} itemSize={{ height: 50 }} />,
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="y" itemSize={(value: string) => ({ height: HEIGHTS[value]! })} />,
      // The item's type from `values`, with no annotation.
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="x" itemSize={(value) => ({ width: value.length * 10, height: 50 })} />,
      // An item of any type, not its element's own `value` attribute's: an object, its size from its fields.
      <Reorder.BatchGroup values={CLIPS} onReorder={() => {}} axis="x" itemSize={(clip) => ({ width: clip.seconds * 40, height: 56 })}>
        <For each={CLIPS}>{(clip) => <Reorder.BatchItem value={clip}>{clip.name}</Reorder.BatchItem>}</For>
      </Reorder.BatchGroup>,
      // @ts-expect-error rows break at the group's width: no `columns` with a function's sizes (Q9)
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="xy" itemSize={sized} columns={3} />,
      // @ts-expect-error only a column's items take the group's width (Q10)
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="x" itemSize={{ height: 50 }} />,
      // @ts-expect-error only a column's items take the group's width (Q10)
      <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="xy" itemSize={(value: string) => ({ height: HEIGHTS[value]! })} />,
    ]
    void typed
  })
})
