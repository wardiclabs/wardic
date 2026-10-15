// `<Reorder>` and drag elements on a server (ADR-0020 *SSR*, ADR-0003): rendered with
// Solid's server build in the `node` environment (no `window`, no `document`), on
// DomLive (ADR-0021).
//
// The contract is Motion's server markup (Reorder/__tests__/server.ssr.test.tsx:6-20 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8):
//
//   <article style="overflow-anchor:none"><main draggable="false" style="z-index:unset;
//   transform:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;
//   touch-action:pan-x"></main></article>
//
// pinned by what it carries: the group's `overflow-anchor: none`, the items in `values`
// order, and every drag element's defaults. Motion's `z-index:unset` and
// `transform:none` are its motion values' resting output; Wardic writes no z-index at
// rest (the raise is the engine's, while dragged) and no transform at its Initial value,
// so neither is pinned. The markup is parsed rather than compared whole, because Solid's
// `renderToString` adds hydration keys.
import { createReorderGroup, Reorder, wardic } from "@wardic/solid"
import { For, type JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { expectDragDefaults, serve, tagsOf } from "./ssr-helpers.ts"

const VALUES = ["a", "b", "c"]
const list = (props: { readonly groupAs?: "div"; readonly itemAs?: "span"; readonly groupStyle?: JSX.CSSProperties; readonly itemStyle?: JSX.CSSProperties } = {}) => () => (
  <Reorder.Group values={VALUES} onReorder={() => {}} {...(props.groupAs !== undefined ? { as: props.groupAs } : {})} style={props.groupStyle}>
    <For each={VALUES}>
      {(value) => (
        <Reorder.Item value={value} data-value={value} {...(props.itemAs !== undefined ? { as: props.itemAs } : {})} style={props.itemStyle}>
          {value}
        </Reorder.Item>
      )}
    </For>
  </Reorder.Group>
)

describe("server rendering", () => {
  it("SS0 (guard): the tier renders a wardic element's Initial value on the server", () => {
    const [div] = tagsOf(serve(() => <wardic.div initial={{ opacity: 0 }} />))
    expect(div?.name).toBe("div")
    expect(div?.style.opacity).toBe("0")
  })

  it("SS1: Motion's markup: a ul with overflow-anchor none, its li in values order, each with the drag defaults", () => {
    const tags = tagsOf(serve(list()))
    const [group, ...items] = tags
    expect(group?.name).toBe("ul")
    expect(group?.style["overflow-anchor"]).toBe("none")
    expect(items.map((t) => [t.name, t.attrs["data-value"]])).toEqual([
      ["li", "a"],
      ["li", "b"],
      ["li", "c"],
    ])
    for (const item of items) expectDragDefaults(item, "pan-x")
  })

  it("SS2: `as` renders other tags", () => {
    const [group, ...items] = tagsOf(serve(list({ groupAs: "div", itemAs: "span" })))
    expect(group?.name).toBe("div")
    expect(items.map((t) => t.name)).toEqual(["span", "span", "span"])
  })

  it("SS3: the user's style merges on the group and the items, over the defaults", () => {
    const [group, ...items] = tagsOf(
      serve(list({ groupStyle: { color: "red", "overflow-anchor": "auto" }, itemStyle: { margin: "10px", "user-select": "text" } })),
    )
    expect(group?.style.color).toBe("red")
    expect(group?.style["overflow-anchor"]).toBe("auto")
    for (const item of items) {
      expect(item.style.margin).toBe("10px")
      expect(item.style["user-select"]).toBe("text")
      expect(item.style["touch-action"]).toBe("pan-x")
      expect(item.attrs.draggable).toBe("false")
    }
  })

  it("SS4: a wardic drag element renders the drag defaults for its axis; one without drag renders none", () => {
    const [x] = tagsOf(serve(() => <wardic.div drag="x" />))
    expectDragDefaults(x!, "pan-y")
    const [plain] = tagsOf(serve(() => <wardic.div initial={{ opacity: 1 }} />))
    expect(plain?.attrs.draggable).toBeUndefined()
    expect(plain?.style["touch-action"]).toBeUndefined()
    expect(plain?.style["user-select"]).toBeUndefined()
  })

  it("SS5: createReorderGroup's spread on a plain ul renders overflow-anchor none", () => {
    function Group(): JSX.Element {
      const group = createReorderGroup({ values: VALUES, onReorder: () => {} })
      return <ul {...group()} />
    }
    const [ul] = tagsOf(serve(() => <Group />))
    expect(ul?.name).toBe("ul")
    expect(ul?.style["overflow-anchor"]).toBe("none")
  })

  it("SS6: a group of items renders with no window or document, and nothing throws", () => {
    expect(typeof window, "a server has no window").toBe("undefined")
    expect(typeof document, "a server has no document").toBe("undefined")
    expect(() => serve(list())).not.toThrow()
  })

  it("SS7: each item is a tab stop for the keyboard reorder (#43), with no aria-describedby until the client's instructions exist", () => {
    const [, ...items] = tagsOf(serve(list()))
    for (const item of items) {
      expect(item.attrs.tabindex).toBe("0")
      expect(item.attrs["aria-describedby"]).toBeUndefined()
    }
    // The app's own tabIndex wins; with the keyboard reorder off, no tab stop.
    const own = () => (
      <Reorder.Group values={VALUES} onReorder={() => {}}>
        <For each={VALUES}>{(value) => <Reorder.Item value={value} tabIndex={-1}>{value}</Reorder.Item>}</For>
      </Reorder.Group>
    )
    for (const item of tagsOf(serve(own)).slice(1)) expect(item.attrs.tabindex).toBe("-1")
    const off = () => (
      <Reorder.Group values={VALUES} onReorder={() => {}} keyboard={false}>
        <For each={VALUES}>{(value) => <Reorder.Item value={value}>{value}</Reorder.Item>}</For>
      </Reorder.Group>
    )
    for (const item of tagsOf(serve(off)).slice(1)) expect(item.attrs.tabindex).toBeUndefined()
  })
})
