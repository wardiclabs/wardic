// `<Reorder>` and drag elements on a server (ADR-0020 *SSR*, ADR-0003): rendered with
// Solid's server build in the `node` environment (no `window`, no `document`), under
// @wardic/test's TestLive until DomLive builds on a server (#41).
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
import { createReorderGroup, Reorder, wardic, WardicProvider } from "@wardic/solid"
import { TestLive } from "@wardic/test"
import { For, type JSX } from "solid-js"
import { renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"

interface Tag {
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly style: Readonly<Record<string, string>>
}

/** Every opening tag in `html`, with its attributes and its parsed inline style. */
const tagsOf = (html: string): ReadonlyArray<Tag> =>
  [...html.matchAll(/<([a-z][a-z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)].map(([, name, rest]) => {
    const attrs = Object.fromEntries([...rest!.matchAll(/([^\s=>]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k!, v ?? ""]))
    const style = Object.fromEntries(
      (attrs.style ?? "")
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d !== "")
        .map((d) => {
          const i = d.indexOf(":")
          return [d.slice(0, i).trim(), d.slice(i + 1).trim()]
        }),
    )
    return { name: name!, attrs, style }
  })

const serve = (ui: () => JSX.Element): string => renderToString(() => <WardicProvider env={TestLive}>{ui()}</WardicProvider>)

/** Motion's drag defaults for a y list's item (touch-action keeps horizontal panning). */
const expectDragDefaults = (t: Tag, touchAction: string): void => {
  expect(t.attrs.draggable, `${t.name} draggable`).toBe("false")
  expect(t.style["touch-action"], `${t.name} touch-action`).toBe(touchAction)
  expect(t.style["user-select"], `${t.name} user-select`).toBe("none")
  expect(t.style["-webkit-user-select"], `${t.name} -webkit-user-select`).toBe("none")
  expect(t.style["-webkit-touch-callout"], `${t.name} -webkit-touch-callout`).toBe("none")
}

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
})
