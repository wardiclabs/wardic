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
import * as DomBatch from "@wardic/dom/DomBatch"
import { Reorder, type WardicBatchValues } from "@wardic/solid/unstable/v2"
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
