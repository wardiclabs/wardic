// `<Reorder>` on a server, on Solid 2 (#209 PR 3b, ADR-0020 *SSR*, ADR-0021), with `@solidjs/web`'s
// server build in the `node` environment: Motion's server markup, as the Solid 1 binding pins it
// (`../reorder.ssr.test.tsx`): the group's `overflow-anchor: none`, the items in `values` order, every
// item's drag defaults with its group's `touch-action`, and the keyboard reorder's tab stop.
//
// - RS1: a ul with overflow-anchor none, its lis in values order, each with the drag defaults.
// - RS2: `as` renders other tags; the user's style merges on the group and the items, over the defaults.
// - RS3: `reorderGroup` / `reorderItem` spread on a plain ul / li render the same.
// - RS4: each item is a tab stop, with no `aria-describedby` until the client's instructions exist;
//   the app's own `tabindex` and ids (props, or a kept item's config) win or come first; with the
//   keyboard reorder off, no tab stop.
// - RS5: `Reorder.Item` outside a `Reorder.Group` throws, as Motion's does.
// - RS6 (#257 item 3): a group's `next("reorderEnd")` never settles on a server and its `each` ends at
//   once: nothing happens there. `Reorder.Group`'s `groupRef` hands the group over there too.
import { Reorder, type ReorderGroup, reorderGroup, reorderItem } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as UndefinedOr from "effect/UndefinedOr"
import { For } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr.ts"

const VALUES = ["a", "b", "c"]

/** A drag element's defaults, with `touchAction`. */
const expectDragDefaults = (tag: Tag | undefined, touchAction: string): void => {
  expect(tag?.style["touch-action"], "touch-action").toBe(touchAction)
  expect(tag?.style["user-select"], "user-select").toBe("none")
  expect(tag?.attrs.draggable, "draggable").toBe("false")
}

const list = (props: { readonly groupAs?: "div"; readonly itemAs?: "span"; readonly groupStyle?: JSX.CSSProperties; readonly itemStyle?: JSX.CSSProperties } = {}) => () => (
  <Reorder.Group values={VALUES} onReorder={() => {}} {...UndefinedOr.match(props.groupAs, { onUndefined: () => ({}), onDefined: (as) => ({ as }) })} style={props.groupStyle}>
    <For each={VALUES}>
      {(value) => (
        <Reorder.Item value={value} data-value={value} {...UndefinedOr.match(props.itemAs, { onUndefined: () => ({}), onDefined: (as) => ({ as }) })} style={props.itemStyle}>
          {value}
        </Reorder.Item>
      )}
    </For>
  </Reorder.Group>
)

describe("<Reorder> on a server, on Solid 2", () => {
  it("RS1: a ul with overflow-anchor none, its lis in values order, each with the drag defaults", () => {
    const [group, ...items] = tagsOf(serve(list()))
    expect(group?.name).toBe("ul")
    expect(group?.style["overflow-anchor"]).toBe("none")
    expect(items.map((t) => [t.name, t.attrs["data-value"]])).toEqual([
      ["li", "a"],
      ["li", "b"],
      ["li", "c"],
    ])
    for (const item of items) expectDragDefaults(item, "pan-x")
  })

  it("RS2: as renders other tags; the user's style merges on the group and the items, over the defaults", () => {
    const [div, ...spans] = tagsOf(serve(list({ groupAs: "div", itemAs: "span" })))
    expect(div?.name).toBe("div")
    expect(spans.map((t) => t.name)).toEqual(["span", "span", "span"])
    const [group, ...items] = tagsOf(serve(list({ groupStyle: { color: "red", "overflow-anchor": "auto" }, itemStyle: { margin: "10px", "user-select": "text" } })))
    expect(group?.style.color).toBe("red")
    expect(group?.style["overflow-anchor"]).toBe("auto")
    for (const item of items) {
      expect(item.style.margin).toBe("10px")
      expect(item.style["user-select"]).toBe("text")
      expect(item.style["touch-action"]).toBe("pan-x")
      expect(item.attrs.draggable).toBe("false")
    }
  })

  it("RS3: reorderGroup and reorderItem spread on a plain ul and li render the same", () => {
    const List = () => {
      const list = reorderGroup({ values: VALUES, onReorder: () => {}, axis: "x", style: { color: "red" } })
      return (
        <ul {...list}>
          <For each={VALUES}>
            {(value) => {
              const row = reorderItem(list, { value, style: { margin: "10px" } })
              return (
                <li {...row} data-value={value}>
                  {value}
                </li>
              )
            }}
          </For>
        </ul>
      )
    }
    const [group, ...items] = tagsOf(serve(() => <List />))
    expect(group?.style["overflow-anchor"]).toBe("none")
    expect(group?.style.color).toBe("red")
    expect(items.map((t) => t.attrs["data-value"])).toEqual(VALUES)
    for (const item of items) {
      expectDragDefaults(item, "pan-y")
      expect(item.style.margin).toBe("10px")
      expect(item.attrs.tabindex).toBe("0")
    }
  })

  it("RS4: tab stops with no aria-describedby until the client's; the app's own win or come first; none with the keyboard off", () => {
    for (const item of tagsOf(serve(list())).slice(1)) {
      expect(item.attrs.tabindex).toBe("0")
      expect(item.attrs["aria-describedby"]).toBeUndefined()
    }
    const own = () => (
      <Reorder.Group values={VALUES} onReorder={() => {}}>
        <For each={VALUES}>
          {(value) => (
            <Reorder.Item value={value} tabindex={-1} aria-describedby="hint">
              {value}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    )
    for (const item of tagsOf(serve(own)).slice(1)) {
      expect(item.attrs.tabindex).toBe("-1")
      expect(item.attrs["aria-describedby"]).toBe("hint")
    }
    const Kept = () => {
      const list = reorderGroup({ values: VALUES, onReorder: () => {} })
      return (
        <ul {...list}>
          <For each={VALUES}>
            {(value) => {
              const row = reorderItem(list, { value, tabindex: -1, "aria-describedby": "hint" })
              return <li {...row}>{value}</li>
            }}
          </For>
        </ul>
      )
    }
    for (const item of tagsOf(serve(() => <Kept />)).slice(1)) {
      expect(item.attrs.tabindex).toBe("-1")
      expect(item.attrs["aria-describedby"]).toBe("hint")
    }
    const off = () => (
      <Reorder.Group values={VALUES} onReorder={() => {}} keyboard={false}>
        <For each={VALUES}>{(value) => <Reorder.Item value={value}>{value}</Reorder.Item>}</For>
      </Reorder.Group>
    )
    for (const item of tagsOf(serve(off)).slice(1)) expect(item.attrs.tabindex).toBeUndefined()
  })

  it("RS5: Reorder.Item outside a Reorder.Group throws, as Motion's does", () => {
    expect(() => serve(() => <Reorder.Item value="a">a</Reorder.Item>)).toThrow("Reorder.Item must be a child of Reorder.Group")
  })

  it("RS6: a group's next never settles on a server, its each ends at once, and groupRef hands it over (#257 item 3)", async () => {
    let made: ReorderGroup<string> | undefined
    let handed: ReorderGroup<string> | undefined
    serve(() => {
      made = reorderGroup({ values: ["a"], onReorder: () => {} })
      return (
        <Reorder.Group values={["a"]} onReorder={() => {}} groupRef={(list: ReorderGroup<string>) => (handed = list)}>
          <Reorder.Item value="a">a</Reorder.Item>
        </Reorder.Group>
      )
    })
    expect(handed, "groupRef hands the group over").toBeDefined()
    let settled = false
    void made!.next("reorderEnd").then(() => (settled = true))
    const seen: Array<unknown> = []
    for await (const end of handed!.each("reorderEnd")) seen.push(end)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(seen, "each ends at once").toEqual([])
    expect(settled, "next never settles").toBe(false)
  })
})
